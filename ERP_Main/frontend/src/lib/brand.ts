/**
 * Brand name for ERP_Main Control Plane shown in sidebar and document.title.
 */

import { DEFAULT_BRAND_NAME } from "./nav";

const CACHE_KEY = "erp_main_brand_name";

type Listener = (name: string) => void;
const listeners = new Set<Listener>();

export function subscribeBrandName(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedBrandName(): string {
  const stored = sessionStorage.getItem(CACHE_KEY);
  if (stored && stored.includes("Control Plane")) {
    sessionStorage.removeItem(CACHE_KEY);
    return DEFAULT_BRAND_NAME;
  }
  return stored || DEFAULT_BRAND_NAME;
}

export function setBrandName(name: string): void {
  sessionStorage.setItem(CACHE_KEY, name);
  listeners.forEach((listener) => listener(name));
}

export function invalidateBrandNameCache(): void {
  sessionStorage.removeItem(CACHE_KEY);
}

export async function resolveBrandName(): Promise<string> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) return cached;
  setBrandName(DEFAULT_BRAND_NAME);
  return DEFAULT_BRAND_NAME;
}
