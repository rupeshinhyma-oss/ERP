/**
 * PipelineSetupPage — Inhyma CRM Pipeline & Stage Management.
 *
 * Implements Phase 2 CRM Pipeline Setup:
 * - AppShell with activeKey="crm-pipelines"
 * - Breadcrumb: Home / CRM / Pipeline Setup
 * - Action Bar: "+ ADD PIPELINE", "REFRESH"
 * - Pipeline summary metrics (Total, Default, Active, Total Stages)
 * - Main Pipelines Table with search & status filters:
 *     Name, Description, Default status, Active/Inactive status, Stage count, Lead count, Actions
 * - Create & Edit Pipeline Modal/Drawer (with live trimmed validation & default safety notes)
 * - Stage Management Drawer:
 *     Ordered stage list with Up/Down sequence controls,
 *     Stage Type badges (open, won, lost),
 *     Explicit Initial Stage indicator and switcher,
 *     Add / Edit Stage modal,
 *     Safe stage deletion and deactivation protections.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, apiPost, apiPut, apiDelete, errorMessage } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { auth } from "@/lib/auth";
import { Modal, ErrorBanner, StatusBadge } from "@/components/ui";
import {
  IconPlus,
  IconRefresh,
  IconEdit,
  IconTrash,
  IconPipeline,
  IconSliders,
} from "@/components/icons";

export interface CrmStageItem {
  id: string;
  pipeline_id: string;
  name: string;
  stage_order: number;
  stage_type: "open" | "won" | "lost";
  is_initial: boolean;
  is_active: boolean;
  lead_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateStageDraft {
  tempId: string;
  name: string;
  stage_type: "open" | "won" | "lost";
  is_initial: boolean;
}

export const STANDARD_TEMPLATE_STAGES: Array<{
  name: string;
  stage_type: "open" | "won" | "lost";
  is_initial: boolean;
}> = [
  { name: "New Lead", stage_type: "open", is_initial: true },
  { name: "Contacted", stage_type: "open", is_initial: false },
  { name: "Proposal Sent", stage_type: "open", is_initial: false },
  { name: "Closed Won", stage_type: "won", is_initial: false },
  { name: "Closed Lost", stage_type: "lost", is_initial: false },
];

export function getFreshStandardStages(): CreateStageDraft[] {
  return STANDARD_TEMPLATE_STAGES.map((s, idx) => ({
    ...s,
    tempId: `std-stage-${idx + 1}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
  }));
}

export function isUntouchedStandardStages(stages: CreateStageDraft[]): boolean {
  if (stages.length !== STANDARD_TEMPLATE_STAGES.length) return false;
  return stages.every(
    (s, idx) =>
      s.name.trim() === STANDARD_TEMPLATE_STAGES[idx].name &&
      s.stage_type === STANDARD_TEMPLATE_STAGES[idx].stage_type &&
      s.is_initial === STANDARD_TEMPLATE_STAGES[idx].is_initial
  );
}

export interface CrmPipelineItem {
  id: string;
  name: string;
  description?: string | null;
  is_default: boolean;
  is_active: boolean;
  stage_count: number;
  lead_count: number;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  stages?: CrmStageItem[];
}

export function PipelineSetupPage() {
  const showToast = useToast();
  const canManage = auth.hasPermission("crm.pipelines.manage");

  // Main data states
  const [pipelines, setPipelines] = useState<CrmPipelineItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  // Pipeline Create/Edit Modal
  const [pipelineModalOpen, setPipelineModalOpen] = useState<boolean>(false);
  const [editingPipeline, setEditingPipeline] = useState<CrmPipelineItem | null>(null);
  const [pipelineName, setPipelineName] = useState<string>("");
  const [pipelineDesc, setPipelineDesc] = useState<string>("");
  const [pipelineIsDefault, setPipelineIsDefault] = useState<boolean>(false);
  const [pipelineIsActive, setPipelineIsActive] = useState<boolean>(true);
  const [pipelineSubmitting, setPipelineSubmitting] = useState<boolean>(false);
  const [pipelineFormError, setPipelineFormError] = useState<string | null>(null);
  const [nameFieldError, setNameFieldError] = useState<string | null>(null);
  const [stagesFieldError, setStagesFieldError] = useState<string | null>(null);

  // Pipeline Create: Stage Setup Strategy & Draft Stages
  const [stageSetupOption, setStageSetupOption] = useState<"standard" | "custom">("standard");
  const [createStages, setCreateStages] = useState<CreateStageDraft[]>(getFreshStandardStages());

  // Draft Stage Modal (Add / Edit stage in Create Pipeline Drawer)
  const [draftStageModalOpen, setDraftStageModalOpen] = useState<boolean>(false);
  const [editingDraftStage, setEditingDraftStage] = useState<CreateStageDraft | null>(null);
  const [draftStageName, setDraftStageName] = useState<string>("");
  const [draftStageType, setDraftStageType] = useState<"open" | "won" | "lost">("open");
  const [draftStageIsInitial, setDraftStageIsInitial] = useState<boolean>(false);
  const [draftStageError, setDraftStageError] = useState<string | null>(null);

  // Stage Management Drawer
  const [stageDrawerOpen, setStageDrawerOpen] = useState<boolean>(false);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [activePipelineDetail, setActivePipelineDetail] = useState<CrmPipelineItem | null>(null);
  const [stageLoading, setStageLoading] = useState<boolean>(false);
  const [stageError, setStageError] = useState<string | null>(null);

  // Stage Add/Edit Modal
  const [stageModalOpen, setStageModalOpen] = useState<boolean>(false);
  const [editingStage, setEditingStage] = useState<CrmStageItem | null>(null);
  const [stageName, setStageName] = useState<string>("");
  const [stageType, setStageType] = useState<"open" | "won" | "lost">("open");
  const [stageIsInitial, setStageIsInitial] = useState<boolean>(false);
  const [stageIsActive, setStageIsActive] = useState<boolean>(true);
  const [stageSubmitting, setStageSubmitting] = useState<boolean>(false);
  const [stageFormError, setStageFormError] = useState<string | null>(null);

  // Confirmation Modals
  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
  const [confirmTitle, setConfirmTitle] = useState<string>("");
  const [confirmMessage, setConfirmMessage] = useState<string>("");
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const fetchPipelines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<CrmPipelineItem[]>("/api/v1/crm/pipelines");
      setPipelines(res.data || []);
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  const fetchPipelineDetail = useCallback(
    async (id: string) => {
      setStageLoading(true);
      setStageError(null);
      try {
        const res = await apiGet<CrmPipelineItem>(`/api/v1/crm/pipelines/${id}`);
        setActivePipelineDetail(res.data || null);
      } catch (err) {
        const msg = errorMessage(err);
        setStageError(msg);
        showToast(msg, "error");
      } finally {
        setStageLoading(false);
      }
    },
    [showToast]
  );

  // ---------------------------------------------------------------------------
  // Pipeline Handlers
  // ---------------------------------------------------------------------------

  const handleOpenCreatePipeline = () => {
    setEditingPipeline(null);
    setPipelineName("");
    setPipelineDesc("");
    setPipelineIsDefault(false);
    setPipelineIsActive(true);
    setStageSetupOption("standard");
    setCreateStages(getFreshStandardStages());
    setPipelineFormError(null);
    setNameFieldError(null);
    setStagesFieldError(null);
    setPipelineModalOpen(true);
  };

  const handleOpenEditPipeline = (pipe: CrmPipelineItem) => {
    setEditingPipeline(pipe);
    setPipelineName(pipe.name);
    setPipelineDesc(pipe.description || "");
    setPipelineIsDefault(pipe.is_default);
    setPipelineIsActive(pipe.is_active);
    setPipelineFormError(null);
    setNameFieldError(null);
    setStagesFieldError(null);
    setPipelineModalOpen(true);
  };

  // ---------------------------------------------------------------------------
  // Stage Setup Options Switching (Standard Template vs Custom Pipeline)
  // ---------------------------------------------------------------------------

  const handleSelectStandardTemplate = () => {
    if (stageSetupOption === "standard") return;
    const hasCustomEdits = !isUntouchedStandardStages(createStages) && createStages.length > 0;
    if (hasCustomEdits) {
      setConfirmTitle("Reset to Standard Template?");
      setConfirmMessage(
        "Switching to the Standard Template will replace your current stages with the 5 default template stages. Any customized stages will be discarded. Do you wish to continue?"
      );
      setConfirmAction(() => async () => {
        setStageSetupOption("standard");
        setCreateStages(getFreshStandardStages());
        setConfirmModalOpen(false);
      });
      setConfirmModalOpen(true);
    } else {
      setStageSetupOption("standard");
      setCreateStages(getFreshStandardStages());
    }
  };

  const handleSelectCustomPipeline = () => {
    if (stageSetupOption === "custom") return;
    const hasEdits = !isUntouchedStandardStages(createStages) && createStages.length > 0;
    if (hasEdits) {
      setConfirmTitle("Clear Stages for Custom Pipeline?");
      setConfirmMessage(
        "Switching to Custom Pipeline will clear your customized stages so you can define your own stages from scratch. Do you wish to continue?"
      );
      setConfirmAction(() => async () => {
        setStageSetupOption("custom");
        setCreateStages([]);
        setConfirmModalOpen(false);
      });
      setConfirmModalOpen(true);
    } else {
      setStageSetupOption("custom");
      setCreateStages([]);
    }
  };

  // ---------------------------------------------------------------------------
  // Draft Stage CRUD Handlers (for Create Pipeline Drawer)
  // ---------------------------------------------------------------------------

  const handleOpenAddDraftStage = () => {
    setEditingDraftStage(null);
    setDraftStageName("");
    setDraftStageType("open");
    setDraftStageIsInitial(!createStages.some((s) => s.is_initial));
    setDraftStageError(null);
    setDraftStageModalOpen(true);
  };

  const handleOpenEditDraftStage = (st: CreateStageDraft) => {
    setEditingDraftStage(st);
    setDraftStageName(st.name);
    setDraftStageType(st.stage_type);
    setDraftStageIsInitial(st.is_initial);
    setDraftStageError(null);
    setDraftStageModalOpen(true);
  };

  const handleSaveDraftStage = (e: React.FormEvent) => {
    e.preventDefault();
    setDraftStageError(null);
    const trimmed = draftStageName.trim();
    if (!trimmed) {
      setDraftStageError("Stage name is required and cannot be blank.");
      return;
    }
    if (trimmed.length > 100) {
      setDraftStageError("Stage name cannot exceed 100 characters.");
      return;
    }

    const isDup = createStages.some(
      (s) =>
        s.tempId !== editingDraftStage?.tempId &&
        s.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (isDup) {
      setDraftStageError(`A stage named "${trimmed}" already exists in this pipeline.`);
      return;
    }

    if (draftStageIsInitial && draftStageType !== "open") {
      setDraftStageError("Initial stage must be of type 'open'. Won or lost terminal stages cannot be initial.");
      return;
    }

    if (editingDraftStage) {
      setCreateStages((prev) =>
        prev.map((s) => {
          if (s.tempId === editingDraftStage.tempId) {
            return {
              ...s,
              name: trimmed,
              stage_type: draftStageType,
              is_initial: draftStageIsInitial,
            };
          }
          if (draftStageIsInitial) {
            return { ...s, is_initial: false };
          }
          return s;
        })
      );
    } else {
      const newStage: CreateStageDraft = {
        tempId: `draft-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: trimmed,
        stage_type: draftStageType,
        is_initial: draftStageIsInitial,
      };
      setCreateStages((prev) => {
        const updated = draftStageIsInitial
          ? prev.map((s) => ({ ...s, is_initial: false }))
          : [...prev];
        return [...updated, newStage];
      });
    }

    setDraftStageModalOpen(false);
  };

  const handleSetInitialDraftStage = (tempId: string) => {
    const target = createStages.find((s) => s.tempId === tempId);
    if (!target) return;
    if (target.stage_type !== "open") {
      showToast("Only stages of type 'open' can be designated as the initial landing stage.", "warning");
      return;
    }
    setCreateStages((prev) =>
      prev.map((s) => ({
        ...s,
        is_initial: s.tempId === tempId,
      }))
    );
  };

  const handleMoveDraftStage = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= createStages.length) return;
    setCreateStages((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(targetIndex, 0, item);
      return copy;
    });
  };

  const handleDeleteDraftStage = (tempId: string) => {
    setCreateStages((prev) => {
      const target = prev.find((s) => s.tempId === tempId);
      const filtered = prev.filter((s) => s.tempId !== tempId);
      if (target?.is_initial) {
        const nextInitial = filtered.find((s) => s.stage_type === "open");
        if (nextInitial) {
          nextInitial.is_initial = true;
          showToast(`Initial stage automatically set to "${nextInitial.name}".`, "info");
        }
      }
      return filtered;
    });
  };

  // ---------------------------------------------------------------------------
  // Submit Pipeline (Create or Edit)
  // ---------------------------------------------------------------------------

  const handleSubmitPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    setPipelineFormError(null);
    setNameFieldError(null);
    setStagesFieldError(null);

    const trimmedName = pipelineName.trim();
    if (!trimmedName) {
      setNameFieldError("Pipeline name is required and cannot be blank.");
      setPipelineFormError("Pipeline name is required and cannot be blank.");
      return;
    }
    if (trimmedName.length > 150) {
      setNameFieldError("Pipeline name cannot exceed 150 characters.");
      setPipelineFormError("Pipeline name cannot exceed 150 characters.");
      return;
    }

    if (!editingPipeline) {
      if (createStages.length === 0) {
        setStagesFieldError("At least one stage is required before creating a pipeline.");
        setPipelineFormError("Every pipeline being created must have at least one stage and exactly one initial stage.");
        return;
      }

      for (const st of createStages) {
        if (!st.name.trim()) {
          setStagesFieldError("Stage names are required and cannot be blank.");
          setPipelineFormError("Stage names are required and cannot be blank.");
          return;
        }
        if (st.name.trim().length > 100) {
          setStagesFieldError(`Stage name "${st.name}" cannot exceed 100 characters.`);
          setPipelineFormError(`Stage name "${st.name}" cannot exceed 100 characters.`);
          return;
        }
      }

      const namesSeen = new Set<string>();
      for (const st of createStages) {
        const lower = st.name.trim().toLowerCase();
        if (namesSeen.has(lower)) {
          setStagesFieldError(`Duplicate stage name: "${st.name.trim()}". Stage names must be unique within the pipeline.`);
          setPipelineFormError(`Duplicate stage name: "${st.name.trim()}". Stage names must be unique within the pipeline.`);
          return;
        }
        namesSeen.add(lower);
      }

      const initialCount = createStages.filter((s) => s.is_initial).length;
      if (initialCount === 0) {
        setStagesFieldError("Please designate exactly one initial stage (must be of type 'open').");
        setPipelineFormError("A pipeline must have at least one valid initial stage. Please designate an initial stage.");
        return;
      }
      if (initialCount > 1) {
        setStagesFieldError("A pipeline cannot have multiple initial stages.");
        setPipelineFormError("A pipeline cannot have multiple initial stages.");
        return;
      }

      const initialStage = createStages.find((s) => s.is_initial);
      if (initialStage && initialStage.stage_type !== "open") {
        setStagesFieldError(`Initial stage "${initialStage.name}" must be of type 'open'. Terminal stages ('won' or 'lost') cannot be initial.`);
        setPipelineFormError(`Initial stage "${initialStage.name}" must be of type 'open'. Terminal stages ('won' or 'lost') cannot be initial.`);
        return;
      }
    }

    setPipelineSubmitting(true);
    try {
      if (editingPipeline) {
        // Update
        const payload: Record<string, any> = {
          name: trimmedName,
          description: pipelineDesc.trim() || null,
          is_active: pipelineIsActive,
        };
        if (pipelineIsDefault !== editingPipeline.is_default) {
          payload.is_default = pipelineIsDefault;
        }

        await apiPut(`/api/v1/crm/pipelines/${editingPipeline.id}`, payload);
        showToast(`Pipeline "${trimmedName}" updated successfully.`, "success");
      } else {
        // Create
        const payload: Record<string, any> = {
          name: trimmedName,
          description: pipelineDesc.trim() || null,
          is_default: pipelineIsDefault,
          is_active: pipelineIsActive,
          stages: createStages.map((s, idx) => ({
            name: s.name.trim(),
            stage_type: s.stage_type,
            is_initial: s.is_initial,
            stage_order: idx + 1,
            is_active: true,
          })),
        };

        await apiPost("/api/v1/crm/pipelines", payload);
        showToast(`Pipeline "${trimmedName}" created successfully.`, "success");
      }

      setPipelineModalOpen(false);
      await fetchPipelines();
    } catch (err) {
      const msg = errorMessage(err);
      setPipelineFormError(msg);
      showToast(msg, "error");
    } finally {
      setPipelineSubmitting(false);
    }
  };

  const handleSetDefaultPipeline = async (pipe: CrmPipelineItem) => {
    if (pipe.is_default) return;
    try {
      await apiPost(`/api/v1/crm/pipelines/${pipe.id}/set-default`);
      showToast(`Pipeline "${pipe.name}" is now the default pipeline.`, "success");
      await fetchPipelines();
      if (activePipelineDetail?.id === pipe.id) {
        await fetchPipelineDetail(pipe.id);
      }
    } catch (err) {
      showToast(errorMessage(err), "error");
    }
  };

  const handleTogglePipelineActive = async (pipe: CrmPipelineItem) => {
    const promptAction = async () => {
      try {
        setConfirmSubmitting(true);
        await apiPost(`/api/v1/crm/pipelines/${pipe.id}/toggle-active`);
        showToast(
          `Pipeline "${pipe.name}" ${pipe.is_active ? "deactivated" : "activated"} successfully.`,
          "success"
        );
        setConfirmModalOpen(false);
        await fetchPipelines();
        if (activePipelineDetail?.id === pipe.id) {
          await fetchPipelineDetail(pipe.id);
        }
      } catch (err) {
        showToast(errorMessage(err), "error");
      } finally {
        setConfirmSubmitting(false);
      }
    };

    if (pipe.is_active) {
      setConfirmTitle(`Deactivate Pipeline "${pipe.name}"?`);
      setConfirmMessage(
        pipe.is_default
          ? "This pipeline is currently set as the default pipeline. You must designate another active pipeline as default before deactivating this one."
          : `Deactivating this pipeline will prevent new leads from being assigned to it. Ensure there are no active open leads in this pipeline before continuing.`
      );
      setConfirmAction(() => promptAction);
      setConfirmModalOpen(true);
    } else {
      await promptAction();
    }
  };

  const handleDeletePipeline = (pipe: CrmPipelineItem) => {
    setConfirmTitle(`Delete Pipeline "${pipe.name}"?`);
    setConfirmMessage(
      pipe.is_default
        ? "The default pipeline cannot be deleted. Designate another active pipeline as default first."
        : `Are you sure you want to delete this pipeline? Pipelines with existing CRM leads cannot be deleted.`
    );
    setConfirmAction(() => async () => {
      try {
        setConfirmSubmitting(true);
        await apiDelete(`/api/v1/crm/pipelines/${pipe.id}`);
        showToast(`Pipeline "${pipe.name}" deleted successfully.`, "success");
        setConfirmModalOpen(false);
        if (activePipelineId === pipe.id) {
          setStageDrawerOpen(false);
        }
        await fetchPipelines();
      } catch (err) {
        showToast(errorMessage(err), "error");
      } finally {
        setConfirmSubmitting(false);
      }
    });
    setConfirmModalOpen(true);
  };

  // ---------------------------------------------------------------------------
  // Stage Management Handlers
  // ---------------------------------------------------------------------------

  const handleOpenStageDrawer = async (pipe: CrmPipelineItem) => {
    setActivePipelineId(pipe.id);
    setStageDrawerOpen(true);
    await fetchPipelineDetail(pipe.id);
  };

  const handleOpenAddStage = () => {
    setEditingStage(null);
    setStageName("");
    setStageType("open");
    setStageIsInitial(false);
    setStageIsActive(true);
    setStageFormError(null);
    setStageModalOpen(true);
  };

  const handleOpenEditStage = (stage: CrmStageItem) => {
    setEditingStage(stage);
    setStageName(stage.name);
    setStageType(stage.stage_type);
    setStageIsInitial(stage.is_initial);
    setStageIsActive(stage.is_active);
    setStageFormError(null);
    setStageModalOpen(true);
  };

  const handleSubmitStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePipelineId) return;

    setStageFormError(null);
    const trimmed = stageName.trim();
    if (!trimmed) {
      setStageFormError("Stage name is required and cannot be blank.");
      return;
    }
    if (trimmed.length > 100) {
      setStageFormError("Stage name cannot exceed 100 characters.");
      return;
    }

    if (stageIsInitial && stageType !== "open") {
      setStageFormError("An initial stage must be of type 'open'. Won or lost terminal stages cannot be initial stages.");
      return;
    }

    setStageSubmitting(true);
    try {
      if (editingStage) {
        await apiPut(`/api/v1/crm/pipelines/${activePipelineId}/stages/${editingStage.id}`, {
          name: trimmed,
          stage_type: stageType,
          is_initial: stageIsInitial,
          is_active: stageIsActive,
        });
        showToast(`Stage "${trimmed}" updated successfully.`, "success");
      } else {
        await apiPost(`/api/v1/crm/pipelines/${activePipelineId}/stages`, {
          name: trimmed,
          stage_type: stageType,
          is_initial: stageIsInitial,
          is_active: stageIsActive,
        });
        showToast(`Stage "${trimmed}" added successfully.`, "success");
      }
      setStageModalOpen(false);
      await fetchPipelineDetail(activePipelineId);
      await fetchPipelines();
    } catch (err) {
      const msg = errorMessage(err);
      setStageFormError(msg);
      showToast(msg, "error");
    } finally {
      setStageSubmitting(false);
    }
  };

  const handleMoveStage = async (stage: CrmStageItem, direction: "up" | "down") => {
    if (!activePipelineDetail || !activePipelineDetail.stages) return;

    const stages = [...activePipelineDetail.stages];
    const currentIndex = stages.findIndex((s) => s.id === stage.id);
    if (currentIndex === -1) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= stages.length) return;

    // Swap positions
    const [moved] = stages.splice(currentIndex, 1);
    stages.splice(targetIndex, 0, moved);

    // Build reorder request with 1-indexed contiguous order
    const reorderPayload = {
      stages: stages.map((s, idx) => ({
        id: s.id,
        stage_order: idx + 1,
      })),
    };

    try {
      await apiPut(`/api/v1/crm/pipelines/${activePipelineId}/stages/reorder`, reorderPayload);
      showToast("Stage order updated.", "success");
      await fetchPipelineDetail(activePipelineId!);
    } catch (err) {
      showToast(errorMessage(err), "error");
    }
  };

  const handleSetInitialStage = async (stage: CrmStageItem) => {
    if (stage.is_initial || !activePipelineId) return;
    if (stage.stage_type !== "open") {
      showToast("Only stages of type 'open' can be set as the initial landing stage.", "warning");
      return;
    }
    try {
      await apiPut(`/api/v1/crm/pipelines/${activePipelineId}/stages/${stage.id}`, {
        is_initial: true,
      });
      showToast(`Stage "${stage.name}" set as initial landing stage.`, "success");
      await fetchPipelineDetail(activePipelineId);
    } catch (err) {
      showToast(errorMessage(err), "error");
    }
  };

  const handleToggleStageActive = async (stage: CrmStageItem) => {
    if (!activePipelineId) return;
    try {
      await apiPost(`/api/v1/crm/pipelines/${activePipelineId}/stages/${stage.id}/toggle-active`);
      showToast(
        `Stage "${stage.name}" ${stage.is_active ? "deactivated" : "activated"} successfully.`,
        "success"
      );
      await fetchPipelineDetail(activePipelineId);
    } catch (err) {
      showToast(errorMessage(err), "error");
    }
  };

  const handleDeleteStage = (stage: CrmStageItem) => {
    if (!activePipelineId) return;
    setConfirmTitle(`Delete Stage "${stage.name}"?`);
    setConfirmMessage(
      stage.is_initial
        ? "This is currently the initial stage of this pipeline. Designate another initial stage before deleting."
        : `Are you sure you want to delete this stage? Stages containing active CRM leads or stage transition history cannot be deleted.`
    );
    setConfirmAction(() => async () => {
      try {
        setConfirmSubmitting(true);
        await apiDelete(`/api/v1/crm/pipelines/${activePipelineId}/stages/${stage.id}`);
        showToast(`Stage "${stage.name}" deleted successfully.`, "success");
        setConfirmModalOpen(false);
        await fetchPipelineDetail(activePipelineId);
        await fetchPipelines();
      } catch (err) {
        showToast(errorMessage(err), "error");
      } finally {
        setConfirmSubmitting(false);
      }
    });
    setConfirmModalOpen(true);
  };

  // ---------------------------------------------------------------------------
  // Filtered pipelines & metrics
  // ---------------------------------------------------------------------------

  const filteredPipelines = useMemo(() => {
    return pipelines.filter((p) => {
      if (statusFilter === "active" && !p.is_active) return false;
      if (statusFilter === "inactive" && p.is_active) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchDesc = p.description?.toLowerCase().includes(q) ?? false;
        if (!matchName && !matchDesc) return false;
      }
      return true;
    });
  }, [pipelines, statusFilter, searchTerm]);

  const defaultPipeline = useMemo(() => pipelines.find((p) => p.is_default), [pipelines]);
  const activeCount = useMemo(() => pipelines.filter((p) => p.is_active).length, [pipelines]);
  const totalStagesCount = useMemo(
    () => pipelines.reduce((sum, p) => sum + (p.stage_count || 0), 0),
    [pipelines]
  );

  return (
    <AppShell activeKey="crm-pipelines">
      <div className="crm-pipeline-page" style={{ padding: "24px 32px", minHeight: "100vh", background: "#f8fafc" }}>
        {/* Breadcrumb Trail */}
        <Breadcrumb trail={["CRM", "Pipeline Setup"]} />

        {/* Header Title & Action Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginTop: "16px",
            marginBottom: "24px",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "26px",
                fontWeight: 700,
                color: "#0f172a",
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  padding: "6px",
                  background: "#e0e7ff",
                  color: "#4338ca",
                  borderRadius: "8px",
                }}
              >
                <IconPipeline style={{ width: "22px", height: "22px" }} />
              </span>
              Pipeline Setup
            </h1>
            <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>
              Configure your organization's sales pipelines, ordered qualification stages, and terminal conversion states.
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={fetchPipelines}
              disabled={loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "8px",
                fontSize: "13.5px",
                fontWeight: 600,
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                cursor: "pointer",
                color: "#334155",
              }}
            >
              <IconRefresh style={{ width: "16px", height: "16px" }} />
              Refresh
            </button>

            {canManage && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleOpenCreatePipeline}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 18px",
                  borderRadius: "8px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  background: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  boxShadow: "0 2px 4px rgba(37,99,235,0.2)",
                  cursor: "pointer",
                }}
              >
                <IconPlus style={{ width: "16px", height: "16px" }} />
                Add Pipeline
              </button>
            )}
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div style={{ marginBottom: "20px" }}>
            <ErrorBanner error={error} />
          </div>
        )}

        {/* Metrics Summary Strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
              Total Pipelines
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>
              {pipelines.length}
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
              Active Pipelines
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#16a34a", marginTop: "4px" }}>
              {activeCount}
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
              Default Pipeline
            </div>
            <div
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: defaultPipeline ? "#1e293b" : "#94a3b8",
                marginTop: "10px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {defaultPipeline ? defaultPipeline.name : "None Configured"}
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              padding: "16px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748b", textTransform: "uppercase" }}>
              Configured Stages
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#4f46e5", marginTop: "4px" }}>
              {totalStagesCount}
            </div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div
          style={{
            background: "#ffffff",
            padding: "16px 20px",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "260px" }}>
            <input
              type="text"
              placeholder="Search pipelines by name or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "360px",
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "13.5px",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#64748b" }}>Status:</span>
            {(["all", "active", "inactive"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  textTransform: "capitalize",
                  cursor: "pointer",
                  border: statusFilter === filter ? "1px solid #2563eb" : "1px solid #e2e8f0",
                  background: statusFilter === filter ? "#eff6ff" : "#ffffff",
                  color: statusFilter === filter ? "#1d4ed8" : "#64748b",
                }}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* Main Pipelines Table Card */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13.5px" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ padding: "14px 18px", fontWeight: 600, color: "#475569", width: "80px" }}>Default</th>
                  <th style={{ padding: "14px 18px", fontWeight: 600, color: "#475569" }}>Pipeline Name</th>
                  <th style={{ padding: "14px 18px", fontWeight: 600, color: "#475569" }}>Description</th>
                  <th style={{ padding: "14px 18px", fontWeight: 600, color: "#475569", width: "110px" }}>Status</th>
                  <th style={{ padding: "14px 18px", fontWeight: 600, color: "#475569", width: "110px" }}>Stages</th>
                  <th style={{ padding: "14px 18px", fontWeight: 600, color: "#475569", width: "90px" }}>Leads</th>
                  <th style={{ padding: "14px 18px", fontWeight: 600, color: "#475569", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                      Loading pipelines...
                    </td>
                  </tr>
                ) : filteredPipelines.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: "48px 20px", textAlign: "center" }}>
                      <div style={{ color: "#94a3b8", fontSize: "15px", fontWeight: 500 }}>
                        {searchTerm || statusFilter !== "all"
                          ? "No pipelines match the applied filter criteria."
                          : "No sales pipelines found. Click 'Add Pipeline' above to configure your first workflow."}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredPipelines.map((pipe) => (
                    <tr
                      key={pipe.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "14px 18px" }}>
                        {pipe.is_default ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "3px 8px",
                              background: "#fef3c7",
                              color: "#b45309",
                              borderRadius: "12px",
                              fontSize: "11px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              border: "1px solid #fde68a",
                            }}
                          >
                            ★ Default
                          </span>
                        ) : (
                          <span style={{ color: "#cbd5e1" }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: "14px 18px" }}>
                        <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "14px" }}>
                          {pipe.name}
                        </div>
                      </td>

                      <td style={{ padding: "14px 18px", color: "#64748b", maxWidth: "300px" }}>
                        {pipe.description || <span style={{ color: "#94a3b8", fontStyle: "italic" }}>No description</span>}
                      </td>

                      <td style={{ padding: "14px 18px" }}>
                        <StatusBadge isActive={pipe.is_active} />
                      </td>

                      <td style={{ padding: "14px 18px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 8px",
                            background: "#ede9fe",
                            color: "#6d28d9",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 600,
                          }}
                        >
                          {pipe.stage_count} {pipe.stage_count === 1 ? "Stage" : "Stages"}
                        </span>
                      </td>

                      <td style={{ padding: "14px 18px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 8px",
                            background: pipe.lead_count > 0 ? "#e0f2fe" : "#f1f5f9",
                            color: pipe.lead_count > 0 ? "#0369a1" : "#64748b",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 600,
                          }}
                        >
                          {pipe.lead_count}
                        </span>
                      </td>

                      <td style={{ padding: "14px 18px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => handleOpenStageDrawer(pipe)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              padding: "5px 10px",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: 600,
                              background: "#f1f5f9",
                              color: "#334155",
                              border: "1px solid #cbd5e1",
                              cursor: "pointer",
                            }}
                          >
                            <IconSliders style={{ width: "13px", height: "13px" }} />
                            Manage Stages
                          </button>

                          {canManage && !pipe.is_default && pipe.is_active && (
                            <button
                              type="button"
                              onClick={() => handleSetDefaultPipeline(pipe)}
                              title="Set as Default Pipeline"
                              style={{
                                padding: "5px 9px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: 600,
                                background: "#fffbeb",
                                color: "#d97706",
                                border: "1px solid #fde68a",
                                cursor: "pointer",
                              }}
                            >
                              Make Default
                            </button>
                          )}

                          {canManage && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditPipeline(pipe)}
                              title="Edit Pipeline"
                              style={{
                                padding: "5px 8px",
                                borderRadius: "6px",
                                background: "#ffffff",
                                color: "#475569",
                                border: "1px solid #cbd5e1",
                                cursor: "pointer",
                              }}
                            >
                              <IconEdit style={{ width: "13px", height: "13px" }} />
                            </button>
                          )}

                          {canManage && (
                            <button
                              type="button"
                              onClick={() => handleTogglePipelineActive(pipe)}
                              title={pipe.is_active ? "Deactivate Pipeline" : "Activate Pipeline"}
                              style={{
                                padding: "5px 9px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 600,
                                background: pipe.is_active ? "#fef2f2" : "#f0fdf4",
                                color: pipe.is_active ? "#dc2626" : "#16a34a",
                                border: `1px solid ${pipe.is_active ? "#fecaca" : "#bbf7d0"}`,
                                cursor: "pointer",
                              }}
                            >
                              {pipe.is_active ? "Deactivate" : "Activate"}
                            </button>
                          )}

                          {canManage && !pipe.is_default && (
                            <button
                              type="button"
                              onClick={() => handleDeletePipeline(pipe)}
                              title="Delete Pipeline"
                              style={{
                                padding: "5px 8px",
                                borderRadius: "6px",
                                background: "#ffffff",
                                color: "#ef4444",
                                border: "1px solid #fca5a5",
                                cursor: "pointer",
                              }}
                            >
                              <IconTrash style={{ width: "13px", height: "13px" }} />
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

        {/* =================================================================== */}
        {/* Pipeline Create / Edit Drawer/Modal                                 */}
        {/* =================================================================== */}
        <Modal
          open={pipelineModalOpen}
          title={editingPipeline ? "Edit Pipeline" : "Create Pipeline"}
          onClose={() => !pipelineSubmitting && setPipelineModalOpen(false)}
          variant="drawer"
          cardClassName="crm-pipeline-drawer-card"
          cardStyle={{
            width: "620px",
            maxWidth: "100vw",
            height: "100vh",
            maxHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <form
            onSubmit={handleSubmitPipeline}
            noValidate
            className="crm-pipeline-drawer-form"
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              height: "100%",
              overflow: "hidden",
              margin: 0,
              padding: 0,
            }}
          >
            {/* Single Primary Vertical Scroll Container */}
            <div
              data-testid="pipeline-drawer-scroll-body"
              className="drawer-content-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                padding: "20px 24px",
              }}
            >
              {/* 1. Overall Form Error Banner */}
              {pipelineFormError && (
                <div style={{ marginBottom: "16px" }}>
                  <ErrorBanner error={pipelineFormError} />
                </div>
              )}

              {/* 2. Pipeline Name (required) */}
              <div style={{ marginBottom: "16px" }}>
                <label
                  htmlFor="crm-pipeline-name-input"
                  style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}
                >
                  Pipeline Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  id="crm-pipeline-name-input"
                  type="text"
                  required
                  maxLength={150}
                  placeholder="e.g. Inbound Enterprise Sales, Direct Partnerships"
                  value={pipelineName}
                  onChange={(e) => {
                    setPipelineName(e.target.value);
                    if (nameFieldError) setNameFieldError(null);
                    if (pipelineFormError) setPipelineFormError(null);
                  }}
                  className="form-control"
                  style={{
                    width: "100%",
                    borderColor: nameFieldError ? "#ef4444" : undefined,
                  }}
                />
                {nameFieldError && (
                  <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px" }}>
                    {nameFieldError}
                  </div>
                )}
                <div style={{ fontSize: "11px", color: "#94a3b8", textAlign: "right", marginTop: "4px" }}>
                  {pipelineName.trim().length} / 150 characters
                </div>
              </div>

              {/* 3. Description (optional) */}
              <div style={{ marginBottom: "16px" }}>
                <label
                  htmlFor="crm-pipeline-desc-input"
                  style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}
                >
                  Description (Optional)
                </label>
                <textarea
                  id="crm-pipeline-desc-input"
                  rows={3}
                  placeholder="Describe the sales workflow or target prospect category..."
                  value={pipelineDesc}
                  onChange={(e) => setPipelineDesc(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13.5px",
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {/* 4. Default Pipeline checkbox (compact row) */}
              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    fontSize: "13.5px",
                    fontWeight: 600,
                    color: "#1e293b",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={pipelineIsDefault}
                    onChange={(e) => setPipelineIsDefault(e.target.checked)}
                    style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#2563eb" }}
                  />
                  <span>Default Pipeline</span>
                </label>
                <div style={{ fontSize: "12px", color: "#64748b", marginLeft: "24px", marginTop: "2px" }}>
                  Routes unassigned new leads directly into this pipeline.
                </div>
              </div>

              {/* 5. Active Pipeline checkbox (compact row) */}
              <div style={{ marginBottom: "20px" }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    fontSize: "13.5px",
                    fontWeight: 600,
                    color: "#1e293b",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={pipelineIsActive}
                    onChange={(e) => setPipelineIsActive(e.target.checked)}
                    style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#2563eb" }}
                  />
                  <span>Active Pipeline</span>
                </label>
                <div style={{ fontSize: "12px", color: "#64748b", marginLeft: "24px", marginTop: "2px" }}>
                  Inactive pipelines cannot accept new leads.
                </div>
              </div>

              {/* 6. Stage Setup section (Create mode only) */}
              {!editingPipeline && (
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "16px", marginBottom: "8px" }}>
                  {/* Section Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                    <div>
                      <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#0f172a" }}>
                        Stage Setup <span style={{ color: "#ef4444" }}>*</span>
                      </span>
                      <span style={{ fontSize: "12px", color: "#64748b", marginLeft: "8px" }}>
                        ({createStages.length} {createStages.length === 1 ? "stage" : "stages"})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenAddDraftStage}
                      className="btn btn-secondary"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        color: "#2563eb",
                        cursor: "pointer",
                      }}
                    >
                      <IconPlus style={{ width: "12px", height: "12px" }} />
                      Add Stage
                    </button>
                  </div>

                  {/* Compact Radio Group: Standard Template vs Custom Pipeline */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "24px",
                      padding: "10px 14px",
                      background: "#f8fafc",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                      marginBottom: "14px",
                      flexWrap: "wrap",
                    }}
                  >
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: stageSetupOption === "standard" ? 700 : 500,
                        color: "#1e293b",
                        userSelect: "none",
                      }}
                    >
                      <input
                        type="radio"
                        id="setup-option-standard"
                        name="stageSetupOption"
                        value="standard"
                        checked={stageSetupOption === "standard"}
                        onChange={handleSelectStandardTemplate}
                        style={{ cursor: "pointer", accentColor: "#2563eb" }}
                      />
                      <span>Standard Template</span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          color: "#1d4ed8",
                          background: "#dbeafe",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          marginLeft: "2px",
                        }}
                      >
                        RECOMMENDED
                      </span>
                    </label>

                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: stageSetupOption === "custom" ? 700 : 500,
                        color: "#1e293b",
                        userSelect: "none",
                      }}
                    >
                      <input
                        type="radio"
                        id="setup-option-custom"
                        name="stageSetupOption"
                        value="custom"
                        checked={stageSetupOption === "custom"}
                        onChange={handleSelectCustomPipeline}
                        style={{ cursor: "pointer", accentColor: "#2563eb" }}
                      />
                      <span>Custom Pipeline</span>
                    </label>
                  </div>

                  {/* Stage Setup Field Validation Message */}
                  {stagesFieldError && (
                    <div style={{ fontSize: "12px", color: "#dc2626", marginBottom: "10px" }}>
                      {stagesFieldError}
                    </div>
                  )}

                  {/* Stage List / Empty State */}
                  {createStages.length === 0 ? (
                    <div
                      style={{
                        padding: "24px 16px",
                        textAlign: "center",
                        borderRadius: "8px",
                        border: "1.5px dashed #cbd5e1",
                        background: "#f8fafc",
                      }}
                    >
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#475569" }}>
                        No stages configured yet
                      </div>
                      <p style={{ fontSize: "12px", color: "#64748b", margin: "4px 0 12px 0" }}>
                        A pipeline must have at least one stage and exactly one initial stage. Click below to add your first stage.
                      </p>
                      <button
                        type="button"
                        onClick={handleOpenAddDraftStage}
                        className="btn btn-primary"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 14px",
                          borderRadius: "6px",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          background: "#2563eb",
                          color: "#ffffff",
                          cursor: "pointer",
                          border: "none",
                        }}
                      >
                        <IconPlus style={{ width: "13px", height: "13px" }} />
                        Add First Stage
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {createStages.map((st, idx) => (
                        <div
                          key={st.tempId}
                          data-testid={`stage-row-${idx}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background: "#ffffff",
                            borderRadius: "6px",
                            border: st.is_initial ? "1px solid #93c5fd" : "1px solid #e2e8f0",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
                            gap: "8px",
                          }}
                        >
                          {/* Left: Number, Name, Type pill, Initial badge */}
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                            <span
                              style={{
                                width: "20px",
                                height: "20px",
                                borderRadius: "50%",
                                background: "#f1f5f9",
                                color: "#475569",
                                fontSize: "11px",
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              {idx + 1}
                            </span>
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "#1e293b",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: "260px",
                              }}
                              title={st.name}
                            >
                              {st.name}
                            </span>

                            {/* Stage Type badge */}
                            {st.stage_type === "open" ? (
                              <span
                                style={{
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  background: "#eff6ff",
                                  color: "#1d4ed8",
                                  border: "1px solid #bfdbfe",
                                  flexShrink: 0,
                                }}
                              >
                                Open
                              </span>
                            ) : st.stage_type === "won" ? (
                              <span
                                style={{
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  background: "#dcfce7",
                                  color: "#15803d",
                                  border: "1px solid #bbf7d0",
                                  flexShrink: 0,
                                }}
                              >
                                Won
                              </span>
                            ) : (
                              <span
                                style={{
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  background: "#fee2e2",
                                  color: "#b91c1c",
                                  border: "1px solid #fecaca",
                                  flexShrink: 0,
                                }}
                              >
                                Lost
                              </span>
                            )}

                            {/* Initial Stage indicator */}
                            {st.is_initial && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  background: "#dbeafe",
                                  color: "#1e40af",
                                  border: "1px solid #bfdbfe",
                                  flexShrink: 0,
                                }}
                              >
                                ★ Initial Stage
                              </span>
                            )}
                          </div>

                          {/* Right: Actions */}
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                            {!st.is_initial && st.stage_type === "open" && (
                              <button
                                type="button"
                                onClick={() => handleSetInitialDraftStage(st.tempId)}
                                title="Designate as initial stage"
                                style={{
                                  padding: "3px 8px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  borderRadius: "4px",
                                  border: "1px solid #cbd5e1",
                                  background: "#f8fafc",
                                  color: "#475569",
                                  cursor: "pointer",
                                }}
                              >
                                Set Initial
                              </button>
                            )}

                            {/* Move Up */}
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveDraftStage(idx, "up")}
                              title="Move Up"
                              aria-label={`Move ${st.name} up`}
                              style={{
                                width: "26px",
                                height: "26px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #e2e8f0",
                                background: "#ffffff",
                                borderRadius: "4px",
                                cursor: idx === 0 ? "not-allowed" : "pointer",
                                opacity: idx === 0 ? 0.35 : 1,
                                fontSize: "12px",
                                fontWeight: 700,
                                color: "#475569",
                              }}
                            >
                              ↑
                            </button>

                            {/* Move Down */}
                            <button
                              type="button"
                              disabled={idx === createStages.length - 1}
                              onClick={() => handleMoveDraftStage(idx, "down")}
                              title="Move Down"
                              aria-label={`Move ${st.name} down`}
                              style={{
                                width: "26px",
                                height: "26px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #e2e8f0",
                                background: "#ffffff",
                                borderRadius: "4px",
                                cursor: idx === createStages.length - 1 ? "not-allowed" : "pointer",
                                opacity: idx === createStages.length - 1 ? 0.35 : 1,
                                fontSize: "12px",
                                fontWeight: 700,
                                color: "#475569",
                              }}
                            >
                              ↓
                            </button>

                            {/* Edit Stage */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditDraftStage(st)}
                              title="Edit stage"
                              aria-label={`Edit ${st.name}`}
                              style={{
                                width: "26px",
                                height: "26px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #e2e8f0",
                                background: "#ffffff",
                                borderRadius: "4px",
                                cursor: "pointer",
                                color: "#2563eb",
                              }}
                            >
                              <IconEdit style={{ width: "13px", height: "13px" }} />
                            </button>

                            {/* Remove Stage */}
                            <button
                              type="button"
                              onClick={() => handleDeleteDraftStage(st.tempId)}
                              title="Remove stage"
                              aria-label={`Remove ${st.name}`}
                              style={{
                                width: "26px",
                                height: "26px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #fee2e2",
                                background: "#fff5f5",
                                borderRadius: "4px",
                                cursor: "pointer",
                                color: "#ef4444",
                              }}
                            >
                              <IconTrash style={{ width: "13px", height: "13px" }} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 7. Fixed Action Footer */}
            <div
              data-testid="pipeline-drawer-footer"
              className="form-actions modal-footer drawer-footer-fixed"
              style={{
                flexShrink: 0,
                padding: "14px 24px",
                background: "#ffffff",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                zIndex: 10,
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPipelineModalOpen(false)}
                disabled={pipelineSubmitting}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="pipeline-submit-btn"
                className="btn btn-primary"
                disabled={pipelineSubmitting}
                style={{
                  padding: "8px 20px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {pipelineSubmitting ? "Saving..." : editingPipeline ? "Update Pipeline" : "Create Pipeline"}
              </button>
            </div>
          </form>
        </Modal>

        {/* =================================================================== */}
        {/* Draft Stage Modal (Add / Edit stage in Create Pipeline Drawer)       */}
        {/* =================================================================== */}
        <Modal
          open={draftStageModalOpen}
          title={editingDraftStage ? "Edit Stage" : "Add Stage to Pipeline"}
          onClose={() => setDraftStageModalOpen(false)}
          variant="center"
          cardStyle={{ width: "440px", maxWidth: "90vw" }}
        >
          <form onSubmit={handleSaveDraftStage} style={{ padding: "20px" }}>
            {draftStageError && (
              <div style={{ marginBottom: "14px" }}>
                <ErrorBanner error={draftStageError} />
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                Stage Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                type="text"
                required
                maxLength={100}
                placeholder="e.g. Inquiries, Needs Analysis, Negotiation"
                value={draftStageName}
                onChange={(e) => setDraftStageName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13.5px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ fontSize: "11px", color: "#94a3b8", textAlign: "right", marginTop: "4px" }}>
                {draftStageName.trim().length} / 100 characters
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                Stage Type <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select
                value={draftStageType}
                onChange={(e) => {
                  const newType = e.target.value as "open" | "won" | "lost";
                  setDraftStageType(newType);
                  if (newType !== "open") {
                    setDraftStageIsInitial(false);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13.5px",
                  outline: "none",
                  background: "#ffffff",
                  boxSizing: "border-box",
                }}
              >
                <option value="open">Open (Active Qualification / In Progress)</option>
                <option value="won">Won (Terminal Converted / Deal Closed)</option>
                <option value="lost">Lost (Terminal Closed Lost)</option>
              </select>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  cursor: draftStageType === "open" ? "pointer" : "not-allowed",
                  opacity: draftStageType === "open" ? 1 : 0.6,
                }}
              >
                <input
                  type="checkbox"
                  checked={draftStageIsInitial}
                  disabled={draftStageType !== "open"}
                  onChange={(e) => setDraftStageIsInitial(e.target.checked)}
                  style={{ marginTop: "2px" }}
                />
                <div>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>
                    Initial Landing Stage
                  </span>
                  <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                    New leads entering this pipeline will begin at this stage. Only open stages can be designated as the initial stage.
                  </div>
                </div>
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "14px", borderTop: "1px solid #e2e8f0" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDraftStageModalOpen(false)}
                style={{
                  padding: "7px 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="draft-stage-submit-btn"
                className="btn btn-primary"
                style={{
                  padding: "7px 18px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {editingDraftStage ? "Update Stage" : "Save Stage"}
              </button>
            </div>
          </form>
        </Modal>

        {/* =================================================================== */}
        {/* Stage Management Slide-over Drawer                                  */}
        {/* =================================================================== */}
        <Modal
          open={stageDrawerOpen}
          title={
            activePipelineDetail
              ? `Stages: ${activePipelineDetail.name}`
              : "Pipeline Stages"
          }
          onClose={() => setStageDrawerOpen(false)}
          variant="drawer"
          cardClassName="crm-pipeline-drawer-card"
          cardStyle={{
            width: "840px",
            maxWidth: "96vw",
            height: "100vh",
            maxHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              height: "100%",
              overflow: "hidden",
            }}
          >
            <div
              className="drawer-content-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                padding: "20px 24px",
              }}
            >
            {activePipelineDetail && (
              <div
                style={{
                  background: "#f8fafc",
                  padding: "14px 18px",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  marginBottom: "20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                      {activePipelineDetail.name}
                    </span>
                    {activePipelineDetail.is_default && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          background: "#fef3c7",
                          color: "#b45309",
                          borderRadius: "10px",
                        }}
                      >
                        Default Pipeline
                      </span>
                    )}
                    <StatusBadge isActive={activePipelineDetail.is_active} />
                  </div>
                  {activePipelineDetail.description && (
                    <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "3px" }}>
                      {activePipelineDetail.description}
                    </div>
                  )}
                </div>

                {canManage && (
                  <button
                    type="button"
                    onClick={handleOpenAddStage}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "7px 14px",
                      borderRadius: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      background: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <IconPlus style={{ width: "14px", height: "14px" }} />
                    Add Stage
                  </button>
                )}
              </div>
            )}

            {stageError && (
              <div style={{ marginBottom: "16px" }}>
                <ErrorBanner error={stageError} />
              </div>
            )}

            {stageLoading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                Loading pipeline stages...
              </div>
            ) : !activePipelineDetail?.stages || activePipelineDetail.stages.length === 0 ? (
              <div
                style={{
                  padding: "48px 20px",
                  textAlign: "center",
                  background: "#ffffff",
                  border: "1px dashed #cbd5e1",
                  borderRadius: "10px",
                }}
              >
                <div style={{ color: "#0f172a", fontWeight: 600, fontSize: "15px", marginBottom: "6px" }}>
                  No Stages in this Pipeline
                </div>
                <div style={{ color: "#64748b", fontSize: "13px", marginBottom: "16px" }}>
                  A pipeline must have at least one initial stage before it can be activated.
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleOpenAddStage}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      background: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    + Add Initial Stage
                  </button>
                )}
              </div>
            ) : (
              <div
                className="table-scroll"
                style={{
                  background: "#ffffff",
                  borderRadius: "10px",
                  border: "1px solid #e2e8f0",
                  overflowX: "auto",
                  width: "100%",
                }}
              >
                <table style={{ width: "100%", minWidth: "700px", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "12px 14px", width: "90px", minWidth: "90px", color: "#475569", fontWeight: 600 }}>Order</th>
                      <th style={{ padding: "12px 14px", minWidth: "150px", color: "#475569", fontWeight: 600 }}>Stage Name</th>
                      <th style={{ padding: "12px 14px", width: "115px", minWidth: "115px", color: "#475569", fontWeight: 600 }}>Type</th>
                      <th style={{ padding: "12px 14px", width: "120px", minWidth: "120px", color: "#475569", fontWeight: 600 }}>Role</th>
                      <th style={{ padding: "12px 14px", width: "85px", minWidth: "85px", color: "#475569", fontWeight: 600 }}>Status</th>
                      <th style={{ padding: "12px 14px", width: "70px", minWidth: "70px", color: "#475569", fontWeight: 600 }}>Leads</th>
                      <th style={{ padding: "12px 14px", width: "140px", minWidth: "140px", textAlign: "right", color: "#475569", fontWeight: 600 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePipelineDetail.stages.map((stage, idx) => (
                      <tr
                        key={stage.id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: stage.is_initial ? "#f0fdf4" : "transparent",
                          transition: "background 0.15s ease",
                        }}
                      >
                        {/* Order & Reorder Controls */}
                        <td style={{ padding: "12px 14px", width: "90px", minWidth: "90px", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontWeight: 700, color: "#334155", width: "18px", textAlign: "center" }}>
                              {idx + 1}
                            </span>
                            {canManage && (
                              <div style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveStage(stage, "up")}
                                  title={idx === 0 ? "First stage in pipeline" : "Move Stage Up"}
                                  aria-label={`Move stage ${stage.name} up`}
                                  style={{
                                    width: "22px",
                                    height: "22px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: "1px solid #cbd5e1",
                                    background: "#ffffff",
                                    borderRadius: "4px",
                                    cursor: idx === 0 ? "not-allowed" : "pointer",
                                    color: idx === 0 ? "#cbd5e1" : "#475569",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    padding: 0,
                                    lineHeight: 1,
                                  }}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === activePipelineDetail.stages!.length - 1}
                                  onClick={() => handleMoveStage(stage, "down")}
                                  title={idx === activePipelineDetail.stages!.length - 1 ? "Last stage in pipeline" : "Move Stage Down"}
                                  aria-label={`Move stage ${stage.name} down`}
                                  style={{
                                    width: "22px",
                                    height: "22px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: "1px solid #cbd5e1",
                                    background: "#ffffff",
                                    borderRadius: "4px",
                                    cursor: idx === activePipelineDetail.stages!.length - 1 ? "not-allowed" : "pointer",
                                    color: idx === activePipelineDetail.stages!.length - 1 ? "#cbd5e1" : "#475569",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    padding: 0,
                                    lineHeight: 1,
                                  }}
                                >
                                  ▼
                                </button>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Stage Name */}
                        <td style={{ padding: "12px 14px", minWidth: "150px" }}>
                          <div style={{ fontWeight: 600, color: "#0f172a", wordBreak: "break-word" }}>
                            {stage.name}
                          </div>
                        </td>

                        {/* Stage Type */}
                        <td style={{ padding: "12px 14px", width: "115px", minWidth: "115px", whiteSpace: "nowrap" }}>
                          {stage.stage_type === "open" ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                border: "1px solid #bfdbfe",
                              }}
                            >
                              Open / Active
                            </span>
                          ) : stage.stage_type === "won" ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                background: "#dcfce7",
                                color: "#15803d",
                                border: "1px solid #bbf7d0",
                              }}
                            >
                              ✓ Closed Won
                            </span>
                          ) : (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 700,
                                background: "#fee2e2",
                                color: "#b91c1c",
                                border: "1px solid #fecaca",
                              }}
                            >
                              ✕ Closed Lost
                            </span>
                          )}
                        </td>

                        {/* Initial Stage indicator / Role */}
                        <td style={{ padding: "12px 14px", width: "120px", minWidth: "120px", whiteSpace: "nowrap" }}>
                          {stage.is_initial ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "2px 8px",
                                borderRadius: "10px",
                                fontSize: "10.5px",
                                fontWeight: 700,
                                background: "#15803d",
                                color: "#ffffff",
                              }}
                            >
                              ★ Initial Stage
                            </span>
                          ) : (
                            canManage &&
                            stage.stage_type === "open" && (
                              <button
                                type="button"
                                onClick={() => handleSetInitialStage(stage)}
                                title="Make this stage the initial landing point for new leads"
                                className="btn btn-secondary"
                                style={{
                                  padding: "3px 8px",
                                  fontSize: "11px",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                  lineHeight: 1.2,
                                }}
                              >
                                Set Initial
                              </button>
                            )
                          )}
                        </td>

                        {/* Status */}
                        <td style={{ padding: "12px 14px", width: "85px", minWidth: "85px" }}>
                          <StatusBadge isActive={stage.is_active} />
                        </td>

                        {/* Lead Count */}
                        <td style={{ padding: "12px 14px", width: "70px", minWidth: "70px" }}>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "11.5px",
                              fontWeight: 600,
                              background: stage.lead_count > 0 ? "#e0f2fe" : "#f1f5f9",
                              color: stage.lead_count > 0 ? "#0369a1" : "#64748b",
                            }}
                          >
                            {stage.lead_count}
                          </span>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: "12px 14px", textAlign: "right", width: "140px", minWidth: "140px", whiteSpace: "nowrap" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditStage(stage)}
                                title="Edit Stage"
                                aria-label={`Edit ${stage.name}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: "30px",
                                  height: "30px",
                                  borderRadius: "6px",
                                  background: "#ffffff",
                                  border: "1px solid #cbd5e1",
                                  cursor: "pointer",
                                  color: "#334155",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <IconEdit style={{ width: "14px", height: "14px" }} />
                              </button>
                            )}

                            {canManage && (
                              stage.is_initial ? (
                                <button
                                  type="button"
                                  disabled
                                  title="Initial landing stage must remain active"
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    background: "#f1f5f9",
                                    color: "#94a3b8",
                                    border: "1px solid #e2e8f0",
                                    cursor: "not-allowed",
                                    opacity: 0.7,
                                  }}
                                >
                                  Active
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleToggleStageActive(stage)}
                                  title={stage.is_active ? "Deactivate Stage" : "Activate Stage"}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: "6px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    background: stage.is_active ? "#fef2f2" : "#f0fdf4",
                                    color: stage.is_active ? "#dc2626" : "#16a34a",
                                    border: `1px solid ${stage.is_active ? "#fecaca" : "#bbf7d0"}`,
                                    cursor: "pointer",
                                  }}
                                >
                                  {stage.is_active ? "Deactivate" : "Activate"}
                                </button>
                              )
                            )}

                            {canManage && (
                              stage.is_initial ? (
                                <button
                                  type="button"
                                  disabled
                                  title="Initial stage cannot be deleted. Designate another initial stage first."
                                  aria-label={`Delete ${stage.name}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "30px",
                                    height: "30px",
                                    borderRadius: "6px",
                                    background: "#f8fafc",
                                    border: "1px solid #e2e8f0",
                                    color: "#cbd5e1",
                                    cursor: "not-allowed",
                                    opacity: 0.6,
                                  }}
                                >
                                  <IconTrash style={{ width: "14px", height: "14px" }} />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStage(stage)}
                                  title={stage.lead_count > 0 ? "Stages with leads cannot be deleted" : "Delete Stage"}
                                  aria-label={`Delete ${stage.name}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "30px",
                                    height: "30px",
                                    borderRadius: "6px",
                                    background: "#ffffff",
                                    border: "1px solid #fca5a5",
                                    cursor: "pointer",
                                    color: "#ef4444",
                                    transition: "all 0.15s ease",
                                  }}
                                >
                                  <IconTrash style={{ width: "14px", height: "14px" }} />
                                </button>
                              )
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
        </Modal>

        {/* =================================================================== */}
        {/* Stage Create / Edit Modal                                           */}
        {/* =================================================================== */}
        <Modal
          open={stageModalOpen}
          title={editingStage ? "Edit Pipeline Stage" : "Add Stage to Pipeline"}
          onClose={() => !stageSubmitting && setStageModalOpen(false)}
          variant="center"
          cardStyle={{
            width: "480px",
            maxWidth: "92vw",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: 0,
          }}
        >
          <form
            onSubmit={handleSubmitStage}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              margin: 0,
            }}
          >
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "20px 24px",
              }}
            >
              {stageFormError && (
                <div style={{ marginBottom: "14px" }}>
                  <ErrorBanner error={stageFormError} />
                </div>
              )}

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Stage Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  placeholder="e.g. Discovery Call, Technical Review, Proposal Sent"
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13.5px",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Stage Classification Type
                </label>
                <select
                  value={stageType}
                  onChange={(e) => {
                    const val = e.target.value as "open" | "won" | "lost";
                    setStageType(val);
                    if (val !== "open") {
                      setStageIsInitial(false);
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13.5px",
                    boxSizing: "border-box",
                    background: "#ffffff",
                  }}
                >
                  <option value="open">Open (Active progression stage)</option>
                  <option value="won">Closed Won (Successful deal conversion)</option>
                  <option value="lost">Closed Lost (Dropped or disqualified)</option>
                </select>
              </div>

              <div style={{ marginBottom: "14px", padding: "12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: stageType === "open" ? "pointer" : "not-allowed" }}>
                  <input
                    type="checkbox"
                    disabled={stageType !== "open"}
                    checked={stageIsInitial}
                    onChange={(e) => setStageIsInitial(e.target.checked)}
                    style={{ marginTop: "3px" }}
                  />
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: stageType === "open" ? "#0f172a" : "#94a3b8" }}>
                      Initial Landing Stage
                    </div>
                    <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                      {stageType === "open"
                        ? "New leads created in this pipeline will enter at this stage. Only one initial stage is permitted per pipeline."
                        : "Won or Lost terminal stages cannot serve as the initial landing stage."}
                    </div>
                  </div>
                </label>
              </div>

              <div style={{ marginBottom: "18px", padding: "12px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={stageIsActive}
                    onChange={(e) => setStageIsActive(e.target.checked)}
                    style={{ marginTop: "3px" }}
                  />
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                      Active Stage
                    </div>
                    <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                      Inactive stages cannot have new leads transitioned into them.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div
              style={{
                flexShrink: 0,
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                borderTop: "1px solid #e2e8f0",
                padding: "14px 24px",
                background: "#f8fafc",
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStageModalOpen(false)}
                disabled={stageSubmitting}
                style={{
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={stageSubmitting}
                style={{
                  padding: "8px 18px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {stageSubmitting ? "Saving..." : editingStage ? "Update Stage" : "Add Stage"}
              </button>
            </div>
          </form>
        </Modal>

        {/* =================================================================== */}
        {/* Action Confirmation Modal                                          */}
        {/* =================================================================== */}
        <Modal
          open={confirmModalOpen}
          title={confirmTitle}
          onClose={() => !confirmSubmitting && setConfirmModalOpen(false)}
          variant="center"
          cardStyle={{ width: "420px", maxWidth: "90vw" }}
        >
          <div style={{ padding: "20px" }}>
            <p style={{ fontSize: "13.5px", color: "#475569", lineHeight: "1.5", marginBottom: "20px" }}>
              {confirmMessage}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmModalOpen(false)}
                disabled={confirmSubmitting}
                style={{
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              {confirmAction && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => confirmAction()}
                  disabled={confirmSubmitting}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#dc2626",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {confirmSubmitting ? "Processing..." : "Confirm Action"}
                </button>
              )}
            </div>
          </div>
        </Modal>
      </div>
    </AppShell>
  );
}
