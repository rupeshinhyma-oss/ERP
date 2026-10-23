import { apiGet } from "./api";

export interface CachedMasterProduct {
  id?: string;
  product_name: string;
  product_code?: string | null;
  uom_id?: string | null;
  standard_cost?: number | string | null;
  [key: string]: any;
}

let productCache: CachedMasterProduct[] = [];
let lastFetchedAt = 0;
let inFlightFetch: Promise<CachedMasterProduct[]> | null = null;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes cache validity

/**
 * Instant synchronous client-side filter of cached master products (0ms).
 */
export function filterCachedProducts(query: string, maxResults = 50): CachedMasterProduct[] {
  if (!productCache.length) return [];
  const q = query.trim().toLowerCase();
  if (!q) {
    return productCache.slice(0, maxResults);
  }
  const matches: CachedMasterProduct[] = [];
  for (const p of productCache) {
    const nameMatch = p.product_name && p.product_name.toLowerCase().includes(q);
    const codeMatch = p.product_code && p.product_code.toLowerCase().includes(q);
    if (nameMatch || codeMatch) {
      matches.push(p);
      if (matches.length >= maxResults) break;
    }
  }
  return matches;
}

/**
 * Prefetches or returns active products from the Product Master into memory.
 * Shared across Local Purchase and Import Purchase.
 */
export async function prefetchMasterProducts(): Promise<CachedMasterProduct[]> {
  const isFresh = productCache.length > 0 && Date.now() - lastFetchedAt < CACHE_TTL_MS;
  if (isFresh) {
    return productCache;
  }
  if (inFlightFetch) {
    return inFlightFetch;
  }
  inFlightFetch = (async () => {
    try {
      const res = await apiGet<any[]>("/masters/products?page=1&page_size=100&status=active");
      const items = res?.data || [];
      if (Array.isArray(items) && items.length > 0) {
        const map = new Map<string, CachedMasterProduct>();
        for (const item of items) {
          if (item?.product_name) {
            map.set(item.product_name.toLowerCase(), item);
          }
        }
        productCache = Array.from(map.values());
        lastFetchedAt = Date.now();
      }
      return productCache;
    } catch {
      return productCache;
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

/**
 * Searches active products: returns cached matches and fetches from backend with deduplication.
 */
export async function fetchMasterProducts(
  query: string,
  pageSize = 50
): Promise<CachedMasterProduct[]> {
  const q = query.trim();

  // If query is empty and cache is fresh, return cached slice immediately
  if (!q && productCache.length > 0 && Date.now() - lastFetchedAt < CACHE_TTL_MS) {
    return productCache.slice(0, pageSize);
  }

  const url = q
    ? `/masters/products?page=1&page_size=${pageSize}&status=active&search=${encodeURIComponent(q)}`
    : `/masters/products?page=1&page_size=${pageSize}&status=active`;

  try {
    const res = await apiGet<any[]>(url);
    const items = res?.data || [];
    if (Array.isArray(items)) {
      const map = new Map<string, CachedMasterProduct>();
      for (const p of productCache) {
        if (p?.product_name) map.set(p.product_name.toLowerCase(), p);
      }
      for (const item of items) {
        if (item?.product_name) map.set(item.product_name.toLowerCase(), item);
      }
      productCache = Array.from(map.values());
      if (!q) {
        lastFetchedAt = Date.now();
      }
      return items;
    }
    return [];
  } catch {
    return filterCachedProducts(q, pageSize);
  }
}

/**
 * Clears the product cache (useful for testing or cache invalidation).
 */
export function clearProductCache(): void {
  productCache = [];
  lastFetchedAt = 0;
  inFlightFetch = null;
}
