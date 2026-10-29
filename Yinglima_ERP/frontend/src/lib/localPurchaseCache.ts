/**
 * Local Purchase In-Memory SWR Cache Manager.
 *
 * Provides instantaneous 0ms transitions between list view, detail modal,
 * and edit form without screen-blanking loading flickers.
 *
 * Automatically synchronizes updates across all components when purchases are
 * created, edited, inwarded, or deleted.
 */

import type { LocalPurchaseDetail, LocalPurchaseSummary } from "@/types/localPurchase";

interface ListCacheEntry {
  items: LocalPurchaseSummary[];
  total: number;
  timestamp: number;
}

const listCache = new Map<string, ListCacheEntry>();
const detailCache = new Map<string, { detail: LocalPurchaseDetail; timestamp: number }>();

/** Retrieve cached list page if available */
export function getLocalPurchasesListCache(
  cacheKey: string
): { items: LocalPurchaseSummary[]; total: number } | null {
  const entry = listCache.get(cacheKey);
  if (!entry) return null;
  return { items: [...entry.items], total: entry.total };
}

/** Store list page in memory and seed minimal detail records */
export function setLocalPurchasesListCache(
  cacheKey: string,
  data: { items: LocalPurchaseSummary[]; total: number }
) {
  listCache.set(cacheKey, {
    items: [...data.items],
    total: data.total,
    timestamp: Date.now(),
  });

  // Seed individual detailCache if not already present with full line items
  for (const item of data.items) {
    const existing = detailCache.get(item.id);
    if (existing) {
      // If we already have a cached detail, merge new summary fields while preserving full line items
      existing.detail = {
        ...existing.detail,
        ...item,
        packing_forwarding: item.packing_forwarding ?? existing.detail.packing_forwarding ?? 0,
        transport_expense: item.transport_expense ?? existing.detail.transport_expense ?? 0,
        offloading_expense: item.offloading_expense ?? existing.detail.offloading_expense ?? 0,
        other_expense: item.other_expense ?? existing.detail.other_expense ?? 0,
        items:
          item.items && item.items.length > 0
            ? item.items
            : existing.detail.items ?? [],
      };
      existing.timestamp = Date.now();
    } else {
      detailCache.set(item.id, {
        detail: {
          ...item,
          packing_forwarding: item.packing_forwarding ?? 0,
          transport_expense: item.transport_expense ?? 0,
          offloading_expense: item.offloading_expense ?? 0,
          other_expense: item.other_expense ?? 0,
          items: item.items ?? [],
        },
        timestamp: Date.now(),
      });
    }
  }
}

/** Retrieve cached single purchase detail */
export function getLocalPurchaseDetailCache(id: string): LocalPurchaseDetail | null {
  const entry = detailCache.get(id);
  if (!entry) return null;
  return entry.detail;
}

/** Cache full purchase detail */
export function setLocalPurchaseDetailCache(id: string, detail: LocalPurchaseDetail) {
  detailCache.set(id, {
    detail,
    timestamp: Date.now(),
  });
}

/**
 * Update a local purchase across both detailCache and all active listCache entries.
 * Ensures that edits immediately reflect when navigating back to list or clicking details.
 */
export function updateLocalPurchaseInCache(updated: LocalPurchaseDetail) {
  // 1. Update the detail cache with the latest saved data
  setLocalPurchaseDetailCache(updated.id, updated);

  // 2. Update all cached list views that contain this item
  for (const [, entry] of listCache.entries()) {
    const idx = entry.items.findIndex((it) => it.id === updated.id);
    if (idx !== -1) {
      entry.items[idx] = {
        ...entry.items[idx],
        ...updated,
        items_count: Array.isArray(updated.items) ? updated.items.length : entry.items[idx].items_count,
      };
    } else {
      entry.items.unshift({
        ...updated,
        items_count: Array.isArray(updated.items) ? updated.items.length : 0,
      });
      entry.total += 1;
    }
  }
}

/** Remove deleted purchase from all caches */
export function removeLocalPurchaseFromCache(id: string) {
  detailCache.delete(id);
  for (const [, entry] of listCache.entries()) {
    const idx = entry.items.findIndex((it) => it.id === id);
    if (idx !== -1) {
      entry.items.splice(idx, 1);
      entry.total = Math.max(0, entry.total - 1);
    }
  }
}

/** Invalidate all list caches (forces fresh network fetch next time) */
export function invalidateLocalPurchasesCache() {
  listCache.clear();
}
