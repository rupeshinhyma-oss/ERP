/**
 * Universal In-Memory SWR Cache for Master Data (MasterPage).
 *
 * Keeps table rows, client search caches, and pagination in memory across
 * page transitions. When a user navigates to /masters/products, /masters/brands,
 * /masters/uom, /masters/hsn, /masters/categories, etc., or returns from another
 * page, the cached snapshot renders INSTANTLY (0ms) without blanking or skeleton flicker.
 * A silent background revalidation keeps the list completely fresh.
 */

import type { PaginationMeta } from "@/types";

export interface MasterListCacheEntry<T = any> {
  rows: T[];
  allRecords: T[];
  pagination: PaginationMeta | null;
  timestamp: number;
}

const masterCache = new Map<string, MasterListCacheEntry<any>>();

function buildCacheKey(apiBase: string, queryKey: string): string {
  return `${apiBase}::${queryKey}`;
}

export function getMasterListCache<T = any>(
  apiBase: string,
  queryKey: string
): MasterListCacheEntry<T> | null {
  const key = buildCacheKey(apiBase, queryKey);
  return (masterCache.get(key) as MasterListCacheEntry<T>) || null;
}

export function setMasterListCache<T = any>(
  apiBase: string,
  queryKey: string,
  entry: {
    rows: T[];
    allRecords?: T[];
    pagination: PaginationMeta | null;
  }
): void {
  const key = buildCacheKey(apiBase, queryKey);
  masterCache.set(key, {
    rows: entry.rows,
    allRecords: entry.allRecords || entry.rows,
    pagination: entry.pagination,
    timestamp: Date.now(),
  });
}

export function updateMasterRecordInCache<T extends { id: string }>(
  apiBase: string,
  record: T
): void {
  for (const [key, entry] of masterCache.entries()) {
    if (key.startsWith(`${apiBase}::`)) {
      const updatedRows = entry.rows.map((r: any) =>
        r.id === record.id ? { ...r, ...record } : r
      );
      const updatedAll = entry.allRecords.map((r: any) =>
        r.id === record.id ? { ...r, ...record } : r
      );
      masterCache.set(key, {
        ...entry,
        rows: updatedRows,
        allRecords: updatedAll,
        timestamp: Date.now(),
      });
    }
  }
}

export function removeMasterRecordFromCache(
  apiBase: string,
  recordId: string
): void {
  for (const [key, entry] of masterCache.entries()) {
    if (key.startsWith(`${apiBase}::`)) {
      const updatedRows = entry.rows.filter((r: any) => r.id !== recordId);
      const updatedAll = entry.allRecords.filter((r: any) => r.id !== recordId);
      const newTotal = Math.max(0, (entry.pagination?.total_records || 1) - 1);
      masterCache.set(key, {
        ...entry,
        rows: updatedRows,
        allRecords: updatedAll,
        pagination: entry.pagination
          ? { ...entry.pagination, total_records: newTotal }
          : null,
        timestamp: Date.now(),
      });
    }
  }
}

export function clearMasterListCache(apiBase?: string): void {
  if (apiBase) {
    for (const key of masterCache.keys()) {
      if (key.startsWith(`${apiBase}::`)) {
        masterCache.delete(key);
      }
    }
  } else {
    masterCache.clear();
  }
}
