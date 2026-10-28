/**
 * Sale Process In-Memory SWR Cache Manager.
 *
 * Provides instantaneous 0ms transitions between list view, detail Commercial Invoice modal,
 * and edit form without screen-blanking loading flickers.
 *
 * Automatically synchronizes updates across all components when sale orders are
 * created, edited, dispatched, or deleted.
 */

import type { SaleOrder, SaleSummaryMetrics } from "@/types/saleProcess";
import type { PlanningSheet } from "@/types/planning";

interface ListCacheEntry {
  items: SaleOrder[];
  total: number;
  timestamp: number;
}

interface DetailCacheEntry {
  order: SaleOrder;
  tradeDetails?: any;
  timestamp: number;
}

const listCache = new Map<string, ListCacheEntry>();
const detailCache = new Map<string, DetailCacheEntry>();
const metricsCache = new Map<string, { metrics: SaleSummaryMetrics; timestamp: number }>();
let cachedPlanningSheets: { sheets: PlanningSheet[]; timestamp: number } | null = null;

/** Retrieve cached sale orders list page if available */
export function getSaleOrdersListCache(
  cacheKey: string
): { items: SaleOrder[]; total: number } | null {
  const entry = listCache.get(cacheKey);
  if (!entry) return null;
  return { items: [...entry.items], total: entry.total };
}

/** Store sale orders list page in memory and seed minimal detail records */
export function setSaleOrdersListCache(
  cacheKey: string,
  data: { items: SaleOrder[]; total: number }
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
      existing.order = {
        ...existing.order,
        ...item,
        items: existing.order.items && existing.order.items.length > 0 ? existing.order.items : (item.items ?? []),
      };
      existing.timestamp = Date.now();
    } else {
      detailCache.set(item.id, {
        order: {
          ...item,
          items: item.items ?? [],
        },
        timestamp: Date.now(),
      });
    }
  }
}

/** Retrieve cached single sale order detail */
export function getSaleOrderDetailCache(
  id: string
): { order: SaleOrder; tradeDetails?: any } | null {
  const entry = detailCache.get(id);
  if (!entry) return null;
  return { order: entry.order, tradeDetails: entry.tradeDetails };
}

/** Cache full sale order detail */
export function setSaleOrderDetailCache(id: string, order: SaleOrder, tradeDetails?: any) {
  detailCache.set(id, {
    order,
    tradeDetails,
    timestamp: Date.now(),
  });
}

/** Retrieve cached metrics */
export function getSaleMetricsCache(cacheKey: string): SaleSummaryMetrics | null {
  const entry = metricsCache.get(cacheKey);
  if (!entry) return null;
  return entry.metrics;
}

/** Store metrics in memory */
export function setSaleMetricsCache(cacheKey: string, metrics: SaleSummaryMetrics) {
  metricsCache.set(cacheKey, {
    metrics,
    timestamp: Date.now(),
  });
}

/**
 * Update a sale order across detailCache and all active listCache entries.
 * Ensures edits immediately reflect when navigating back to list or opening details.
 */
export function updateSaleOrderInCache(updated: SaleOrder, tradeDetails?: any) {
  // 1. Update the detail cache
  const existingDetail = detailCache.get(updated.id);
  detailCache.set(updated.id, {
    order: updated,
    tradeDetails: tradeDetails !== undefined ? tradeDetails : existingDetail?.tradeDetails,
    timestamp: Date.now(),
  });

  // 2. Update all cached list views that contain this item
  for (const [, entry] of listCache.entries()) {
    const idx = entry.items.findIndex((it) => it.id === updated.id);
    if (idx !== -1) {
      entry.items[idx] = {
        ...entry.items[idx],
        ...updated,
        item_count: Array.isArray(updated.items) ? updated.items.length : entry.items[idx].item_count,
      };
    } else {
      entry.items.unshift({
        ...updated,
        item_count: Array.isArray(updated.items) ? updated.items.length : 0,
      });
      entry.total += 1;
    }
  }
}

/** Remove deleted sale order from all caches */
export function removeSaleOrderFromCache(id: string) {
  detailCache.delete(id);
  for (const [, entry] of listCache.entries()) {
    const idx = entry.items.findIndex((it) => it.id === id);
    if (idx !== -1) {
      entry.items.splice(idx, 1);
      entry.total = Math.max(0, entry.total - 1);
    }
  }
}

/** Retrieve pre-cached planning sheets */
export function getCachedPlanningSheets(): PlanningSheet[] | null {
  if (!cachedPlanningSheets) return null;
  // Expire after 5 minutes
  if (Date.now() - cachedPlanningSheets.timestamp > 300_000) {
    cachedPlanningSheets = null;
    return null;
  }
  return cachedPlanningSheets.sheets;
}

/** Set pre-cached planning sheets */
export function setCachedPlanningSheets(sheets: PlanningSheet[]) {
  cachedPlanningSheets = {
    sheets: [...sheets],
    timestamp: Date.now(),
  };
}

/** Invalidate all list caches (forces fresh network fetch next time) */
export function invalidateSaleProcessCache() {
  listCache.clear();
  metricsCache.clear();
  cachedPlanningSheets = null;
}
