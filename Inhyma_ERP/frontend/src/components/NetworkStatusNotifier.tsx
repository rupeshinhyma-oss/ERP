/**
 * NetworkStatusNotifier -- Universal offline/online listener.
 *
 * 1. Dynamically toggles the browser tab favicon:
 *    - Online: shows the full-color company logo (/logo.png).
 *    - Offline: converts the company logo to a grayscale version.
 *
 * 2. Displays a floating popup at the bottom-right of the screen when offline:
 *    - "No network connection. Please check your internet connection."
 *    - Auto-dismissing "Internet connection restored" banner when reconnected.
 */

import { useEffect, useState } from "react";
import { getCachedBrandName, getCachedBrandLogo, subscribeBrandLogo, applyBrandFavicon } from "@/lib/brand";

export function NetworkStatusNotifier() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true
  );
  const [showRestored, setShowRestored] = useState(false);
  const [currentLogo, setCurrentLogo] = useState<string | null>(() => getCachedBrandLogo());

  useEffect(() => {
    const unsub = subscribeBrandLogo((logo) => {
      setCurrentLogo(logo);
      applyBrandFavicon(logo, !isOnline);
    });
    return unsub;
  }, [isOnline]);

  useEffect(() => {
    applyBrandFavicon(currentLogo, !isOnline);

    const brandName = getCachedBrandName();
    if (!isOnline) {
      document.title = `${brandName} — Offline`;
    }

    function handleOnline() {
      setIsOnline(true);
      applyBrandFavicon(currentLogo, false);
      setShowRestored(true);
      const timer = setTimeout(() => setShowRestored(false), 3500);
      return () => clearTimeout(timer);
    }

    function handleOffline() {
      setIsOnline(false);
      applyBrandFavicon(currentLogo, true);
      setShowRestored(false);
      document.title = `${getCachedBrandName()} — Offline`;
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [isOnline, currentLogo]);

  if (isOnline && !showRestored) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "14px 20px",
        borderRadius: "12px",
        background: isOnline ? "#059669" : "#dc2626",
        color: "#ffffff",
        boxShadow: isOnline
          ? "0 10px 25px rgba(5, 150, 105, 0.35)"
          : "0 10px 30px rgba(220, 38, 38, 0.45)",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: "14px",
        fontWeight: 600,
        transition: "all 0.3s ease",
        animation: "slideUp 0.3s ease-out",
      }}
    >
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
        }
      `}</style>

      {/* Icon */}
      <div
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          animation: isOnline ? "none" : "pulseGlow 2s infinite",
        }}
      >
        {isOnline ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
            <line x1="12" y1="20" x2="12.01" y2="20"></line>
          </svg>
        )}
      </div>

      {/* Text Message */}
      <div>
        <div style={{ fontSize: "14px", fontWeight: 700, lineHeight: 1.2 }}>
          {isOnline ? "Internet connection restored" : "No network connection"}
        </div>
        <div style={{ fontSize: "12px", opacity: 0.9, marginTop: "2px", fontWeight: 400 }}>
          {isOnline
            ? "Your system is back online."
            : "Please check your internet connection."}
        </div>
      </div>
    </div>
  );
}
