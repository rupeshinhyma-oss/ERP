/**
 * Shared helpers for computing and immediately persisting per-user permission
 * overrides in both User Accounts (Users.tsx) and Departments (Rbac.tsx).
 */

import { apiPut } from "@/lib/api";
import type { BulkPermissionOverrideItem, Permission } from "@/types";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

/** Compute only the explicit grant/deny overrides that differ from department defaults. */
export function buildBulkPermissionOverrides(
  allPermissions: Permission[],
  checkedCodes: Set<string>,
  rolePermissions: string[] = []
): BulkPermissionOverrideItem[] {
  const roleGranted = new Set(rolePermissions);
  const overrides: BulkPermissionOverrideItem[] = [];
  for (const p of allPermissions) {
    const checked = checkedCodes.has(p.code);
    const isRoleGranted = roleGranted.has(p.code);
    if (checked && !isRoleGranted) {
      overrides.push({ permission_id: p.id, is_granted: true });
    } else if (!checked && isRoleGranted) {
      overrides.push({ permission_id: p.id, is_granted: false });
    }
  }
  return overrides;
}

/** Replace direct user overrides on the backend using the computed department diff. */
export async function syncUserPermissionOverrides(
  userId: string,
  allPermissions: Permission[],
  checkedCodes: Set<string>,
  rolePermissions: string[] = []
): Promise<void> {
  const overrides = buildBulkPermissionOverrides(allPermissions, checkedCodes, rolePermissions);
  await apiPut(`/rbac/users/${userId}/permissions/bulk`, { overrides });
}
