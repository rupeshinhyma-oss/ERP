/**
 * Company brand name shown as the sidebar title and in document.title.
 *
 * Cached in sessionStorage so the sidebar doesn't flicker through the default
 * on every navigation. ERP Settings calls invalidateBrandNameCache()
 * after a rename so the new name appears immediately, here and on every other
 * open tab's next navigation.
 */

import { API_ORIGIN, apiGet } from "./api";
import { DEFAULT_BRAND_NAME } from "./nav";
import type { Organization } from "@/types";

const CACHE_KEY = "erp_org_company_name";
const LOGO_CACHE_KEY = "erp_org_company_logo";

type Listener = (name: string) => void;
const listeners = new Set<Listener>();

type LogoListener = (logo: string | null) => void;
const logoListeners = new Set<LogoListener>();

export function subscribeBrandName(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeBrandLogo(listener: LogoListener): () => void {
  logoListeners.add(listener);
  return () => logoListeners.delete(listener);
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

export function invalidateBrandNameCache(): void {
  sessionStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem("erp_brand_name");
}

export function getCachedBrandLogo(): string | null {
  const stored =
    sessionStorage.getItem(LOGO_CACHE_KEY) ||
    localStorage.getItem(LOGO_CACHE_KEY) ||
    localStorage.getItem("erp_brand_logo");
  return (stored && stored.trim()) || null;
}

export function applyBrandFavicon(logoUrl: string | null, isGrayscale = false): void {
  if (typeof document === "undefined") return;

  const rawSrc = (logoUrl && logoUrl.trim()) ? resolveImageUrl(logoUrl) : "/logo.png";

  const updateFaviconTag = (href: string) => {
    try {
      const existingIcons = document.querySelectorAll("link[rel*='icon']");
      const newLink = document.createElement("link");
      newLink.id = "dynamic-favicon";
      newLink.rel = "icon";
      newLink.type = href.startsWith("data:image/svg") ? "image/svg+xml" : "image/png";
      newLink.href = href;

      if (existingIcons.length > 0) {
        existingIcons.forEach((el) => el.parentNode?.removeChild(el));
      }
      document.head.appendChild(newLink);
    } catch {
      const fav = document.getElementById("dynamic-favicon") as HTMLLinkElement | null;
      if (fav) fav.href = href;
    }
  };

  // Immediate fast update so the browser tab updates without delay
  updateFaviconTag(rawSrc);

  // Squared canvas rendering to maintain crisp aspect ratio for wide logos in browser tabs
  if (typeof window !== "undefined" && typeof Image !== "undefined") {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 64;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, size, size);
          if (isGrayscale) {
            ctx.filter = "grayscale(100%) opacity(75%)";
          }
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (w && h) {
            const ratio = Math.min(size / w, size / h);
            const drawW = w * ratio;
            const drawH = h * ratio;
            const x = (size - drawW) / 2;
            const y = (size - drawH) / 2;
            ctx.drawImage(img, x, y, drawW, drawH);
            const dataUrl = canvas.toDataURL("image/png");
            updateFaviconTag(dataUrl);
          }
        }
      } catch {
        // If cross-origin or canvas read fails, rawSrc is already applied
      }
    };
    img.onerror = () => {
      if (rawSrc !== "/logo.png") {
        updateFaviconTag("/logo.png");
      }
    };
    img.src = rawSrc;
  }
}

export function setBrandLogo(logo: string | null): void {
  const cleanLogo = (logo || "").trim() || null;
  if (cleanLogo) {
    sessionStorage.setItem(LOGO_CACHE_KEY, cleanLogo);
    localStorage.setItem(LOGO_CACHE_KEY, cleanLogo);
    localStorage.setItem("erp_brand_logo", cleanLogo);
  } else {
    sessionStorage.removeItem(LOGO_CACHE_KEY);
    localStorage.removeItem(LOGO_CACHE_KEY);
    localStorage.removeItem("erp_brand_logo");
  }
  applyBrandFavicon(cleanLogo);
  logoListeners.forEach((listener) => listener(cleanLogo));
}

export function invalidateBrandLogoCache(): void {
  sessionStorage.removeItem(LOGO_CACHE_KEY);
  localStorage.removeItem(LOGO_CACHE_KEY);
  localStorage.removeItem("erp_brand_logo");
  applyBrandFavicon(null);
  logoListeners.forEach((listener) => listener(null));
}

// Initialize favicon on script load if running in browser
if (typeof window !== "undefined") {
  applyBrandFavicon(getCachedBrandLogo());
}

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  let clean = url.trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1).trim();
  }
  if (!clean) return "";
  if (clean.startsWith("data:")) {
    return clean;
  }
  if (clean.toLowerCase().startsWith("/static/uploads/")) {
    clean = "/static/uploads/" + clean.slice("/static/uploads/".length);
  } else if (clean.toLowerCase().startsWith("/uploads/")) {
    clean = "/uploads/" + clean.slice("/uploads/".length);
  }
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return encodeURI(clean);
  }
  const fullUrl = `${API_ORIGIN}${clean.startsWith("/") ? "" : "/"}${clean}`;
  return encodeURI(fullUrl);
}

export async function resolveBrandInfo(): Promise<{ name: string; logoUrl: string | null }> {
  try {
    const { data } = await apiGet<{ company_name?: string; logo_url?: string; logo_data?: string }>("/organizations/public");
    if (data) {
      if (data.company_name) {
        setBrandName(data.company_name);
      }
      const logo = data.logo_url || data.logo_data || null;
      setBrandLogo(logo);
      return {
        name: data.company_name?.trim() || getCachedBrandName(),
        logoUrl: logo,
      };
    }
  } catch {
    try {
      const { data } = await apiGet<Organization>("/organizations");
      if (data) {
        if (data.company_name) {
          setBrandName(data.company_name);
        }
        const logo = data.logo_url || data.logo_data || null;
        setBrandLogo(logo);
        return {
          name: data.company_name?.trim() || getCachedBrandName(),
          logoUrl: logo,
        };
      }
    } catch {
      // Non-blocking fallback to cached
    }
  }

  return {
    name: getCachedBrandName(),
    logoUrl: getCachedBrandLogo(),
  };
}

export async function resolveBrandName(): Promise<string> {
  const info = await resolveBrandInfo();
  return info.name;
}
