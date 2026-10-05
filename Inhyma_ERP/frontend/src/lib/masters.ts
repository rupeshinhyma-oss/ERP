import { apiPatch, apiPost, apiPut } from "./api";

/**
 * Toggles a master record's status between "active" and "inactive".
 * Tries the activate / deactivate action endpoints (supporting both PATCH and POST),
 * and falls back to standard record update if bespoke action endpoints are absent.
 */
export async function toggleMasterStatus<T = unknown>(
  apiBase: string,
  recordId: string | number,
  newStatus: "active" | "inactive"
): Promise<{ data?: T }> {
  const action = newStatus === "active" ? "activate" : "deactivate";
  const actionUrl = `${apiBase}/${recordId}/${action}`;

  try {
    return await apiPatch<T>(actionUrl, {});
  } catch (err: unknown) {
    const errorStatus = (err as { status?: number })?.status;
    if (errorStatus === 405 || errorStatus === 404) {
      try {
        return await apiPost<T>(actionUrl, {});
      } catch (err2: unknown) {
        const errorStatus2 = (err2 as { status?: number })?.status;
        if (errorStatus2 === 405 || errorStatus2 === 404) {
          try {
            return await apiPatch<T>(`${apiBase}/${recordId}`, { status: newStatus });
          } catch {
            return await apiPut<T>(`${apiBase}/${recordId}`, { status: newStatus });
          }
        }
        throw err2;
      }
    }
    throw err;
  }
}
