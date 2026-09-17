/**
 * API client helpers for Technical Tasks Module.
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type {
  TechnicalTask,
  TechnicalTaskCounts,
  TechnicalTaskCreatePayload,
} from "@/types/technicalTasks";
import type { ApiResult } from "@/types";

export interface TechnicalTaskListParams {
  status?: string;
  task_type?: string;
  priority?: string;
  service_type?: string;
  call_type?: string;
  city?: string;
  task_allotted_to?: string;
  search?: string;
  sort_by?: string;
  sort_desc?: boolean;
  page?: number;
  page_size?: number;
}

export async function fetchTechnicalTasks(
  params: TechnicalTaskListParams = {}
): Promise<ApiResult<TechnicalTask[]>> {
  const query = new URLSearchParams();
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.task_type) query.set("task_type", params.task_type);
  if (params.priority) query.set("priority", params.priority);
  if (params.service_type) query.set("service_type", params.service_type);
  if (params.call_type) query.set("call_type", params.call_type);
  if (params.city) query.set("city", params.city);
  if (params.task_allotted_to) query.set("task_allotted_to", params.task_allotted_to);
  if (params.search) query.set("search", params.search);
  if (params.sort_by) query.set("sort_by", params.sort_by);
  if (params.sort_desc !== undefined) query.set("sort_desc", String(params.sort_desc));
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.page_size !== undefined) query.set("page_size", String(params.page_size));

  const qs = query.toString();
  return apiGet<TechnicalTask[]>(`/technical-tasks${qs ? `?${qs}` : ""}`);
}

export async function fetchTechnicalTaskCounts(): Promise<TechnicalTaskCounts> {
  const res = await apiGet<TechnicalTaskCounts>("/technical-tasks/counts");
  return res.data;
}

export async function fetchTechnicalTask(id: string): Promise<TechnicalTask> {
  const res = await apiGet<TechnicalTask>(`/technical-tasks/${encodeURIComponent(id)}`);
  return res.data;
}

export async function createTechnicalTask(
  payload: TechnicalTaskCreatePayload
): Promise<TechnicalTask> {
  const res = await apiPost<TechnicalTask>("/technical-tasks", payload);
  return res.data;
}

export async function updateTechnicalTask(
  id: string,
  payload: Partial<TechnicalTaskCreatePayload>
): Promise<TechnicalTask> {
  const res = await apiPut<TechnicalTask>(
    `/technical-tasks/${encodeURIComponent(id)}`,
    payload
  );
  return res.data;
}

export async function updateTechnicalTaskStatus(
  id: string,
  status: string,
  remarks?: string
): Promise<TechnicalTask> {
  const res = await apiPatch<TechnicalTask>(
    `/technical-tasks/${encodeURIComponent(id)}/status`,
    { status, remarks }
  );
  return res.data;
}

export async function deleteTechnicalTask(id: string): Promise<void> {
  await apiDelete(`/technical-tasks/${encodeURIComponent(id)}`);
}

export async function bulkDeleteTechnicalTasks(ids: string[]): Promise<number> {
  const res = await apiPost<{ deleted_count: number }>(
    "/technical-tasks/bulk-delete",
    { ids }
  );
  return res.data?.deleted_count ?? 0;
}
