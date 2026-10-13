/**
 * Company brand name shown as the sidebar title and in document.title.
 *
 * Cached in sessionStorage so the sidebar doesn't flicker through the default
 * on every navigation. Organization Settings calls invalidateBrandNameCache()
 * after a rename so the new name appears immediately, here and on every other
 * open tab's next navigation.
 */

import { apiGet } from "./api";
import { DEFAULT_BRAND_NAME } from "./nav";
import type { Organization } from "@/types";

const CACHE_KEY = "erp_org_company_name";

type Listener = (name: string) => void;
const listeners = new Set<Listener>();

export function subscribeBrandName(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedBrandName(): string {
  const stored =
    sessionStorage.getItem(CACHE_KEY) ||
    localStorage.getItem(CACHE_KEY) ||
    localStorage.getItem("erp_brand_name");
  return (stored && stored.trim()) || DEFAULT_BRAND_NAME;
}

export function setBrandName(name: string): void {
  const cleanName = (name || "").trim() || DEFAULT_BRAND_NAME;
  sessionStorage.setItem(CACHE_KEY, cleanName);
  localStorage.setItem(CACHE_KEY, cleanName);
  localStorage.setItem("erp_brand_name", cleanName);
  listeners.forEach((listener) => listener(cleanName));
}

let lastBrandResolvedTime = 0;
let inFlightBrandPromise: Promise<string> | null = null;

export function invalidateBrandNameCache(): void {
  sessionStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem("erp_brand_name");
  lastBrandResolvedTime = 0;
  inFlightBrandPromise = null;
}

export async function resolveBrandName(force = false): Promise<string> {
  const cached = getCachedBrandName();
  if (!force && cached && cached !== DEFAULT_BRAND_NAME && Date.now() - lastBrandResolvedTime < 120000) {
    return cached;
  }

  if (inFlightBrandPromise) {
    return inFlightBrandPromise;
  }

  inFlightBrandPromise = (async () => {
    try {
      const { data } = await apiGet<{ company_name?: string }>("/organizations/public");
      if (data?.company_name) {
        const name = data.company_name.trim();
        setBrandName(name);
        lastBrandResolvedTime = Date.now();
        return name;
      }
    } catch {
      try {
        const { data } = await apiGet<Organization>("/organizations");
        if (data?.company_name) {
          const name = data.company_name.trim();
          setBrandName(name);
          lastBrandResolvedTime = Date.now();
          return name;
        }
      } catch {
        // Non-blocking fallback to cached or default
      }
    } finally {
      inFlightBrandPromise = null;
    }

    const fallback = getCachedBrandName();
    setBrandName(fallback);
    lastBrandResolvedTime = Date.now();
    return fallback;
  })();

  return inFlightBrandPromise;
}
