/**
 * Standardized task deep-link parsing across all task views (Table, Kanban, My Tasks, Calendar).
 * Supports parameter precedence: taskId > id > task_id.
 */

export function getTaskIdFromSearchParams(searchParams: URLSearchParams): string | null {
  const taskId = searchParams.get("taskId");
  if (taskId && taskId.trim()) {
    return taskId.trim();
  }
  const id = searchParams.get("id");
  if (id && id.trim()) {
    return id.trim();
  }
  const task_id = searchParams.get("task_id");
  if (task_id && task_id.trim()) {
    return task_id.trim();
  }
  return null;
}
