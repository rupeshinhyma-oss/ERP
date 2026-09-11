/**
 * Shared React Hooks for ERP_Main Control Plane.
 */

import { useEffect, useState } from "react";
import { Auth, type CurrentUser } from "./auth";
import { getCachedBrandName, subscribeBrandName } from "./brand";

export function useAuth() {
  const [profile, setProfile] = useState<CurrentUser | null>(() => Auth.getProfile());

  useEffect(() => {
    return Auth.subscribe((next) => {
      setProfile(next);
    });
  }, []);

  return {
    profile,
    isLoggedIn: Auth.isLoggedIn(),
    isSuperAdmin: Auth.isSuperAdmin(),
    hasPermission: (key: string) => Auth.hasPermission(key),
  };
}

export function usePageTitle(title: string) {
  const [brandName, setBrand] = useState<string>(getCachedBrandName);

  useEffect(() => {
    return subscribeBrandName((next) => setBrand(next));
  }, []);

  useEffect(() => {
    document.title = title ? `${title} — ${brandName}` : brandName;
  }, [title, brandName]);
}

export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
    };
  }, [locked]);
}

export function useModal(initialOpen = false) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((prev) => !prev),
  };
}
