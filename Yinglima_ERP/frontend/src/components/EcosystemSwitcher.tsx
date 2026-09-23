/**
 * Ecosystem Switcher Dropdown for Yinglima ERP Topbar.
 *
 * Provides one-click instant navigation with seamless Super Admin SSO
 * to Global Control Panel (ERP_Main) and other peer ERP applications.
 */

import { useEffect, useRef, useState } from "react";
import { createSsoHandoverUrl, ECOSYSTEM_ERPS } from "@/lib/ssoBridge";
import { getCachedBrandName, subscribeBrandName } from "@/lib/brand";

interface EcosystemSwitcherProps {
  currentKey?: string;
  organizationName?: string;
}

export function EcosystemSwitcher({ currentKey = "yinglima", organizationName }: EcosystemSwitcherProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [brandName, setBrandName] = useState(() => getCachedBrandName());

  useEffect(() => {
    return subscribeBrandName((newName) => {
      setBrandName(newName);
    });
  }, []);

  const currentErp = ECOSYSTEM_ERPS.find((erp) => erp.key === currentKey);
  const displayName =
    organizationName ||
    (currentKey === "control-plane"
      ? "ERP Dashboard"
      : (brandName || currentErp?.name || "Yinglima ERP"));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  /**
   * Switching to another ERP (or back to the Global Control Panel)
   * from inside a spoke app is deliberately a PLAIN navigation, not a
   * forged handover: this app only holds its own local session, never
   * a Global User session on ERP_Main, so it has no way to mint a
   * genuine, signed authorization for another app -- that would just
   * be a second, weaker door next to the real one.
   *
   * The real, secure ERP-to-ERP switch (OIDC-style authorize -> code
   * -> server-to-server token exchange -> local session) lives on
   * ERP_Main's own ERP Switcher page, gated by that user's actual
   * Global User session and ACTIVE membership. So this control simply
   * takes the user there (or to the target app's normal login/session
   * check) and lets that real flow run -- it never claims to log
   * anyone in on their behalf.
   */
  const handleSwitch = (hostUrl: string) => {
    setOpen(false);
    const target = createSsoHandoverUrl(hostUrl);
    window.location.href = target;
  };

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "5px 12px",
          fontSize: "13px",
          fontWeight: 600,
          color: open ? "#1d4ed8" : "#334155",
          background: open ? "#eff6ff" : "#f1f5f9",
          border: open ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
          borderRadius: "6px",
          cursor: "pointer",
          transition: "all 0.15s ease",
          whiteSpace: "nowrap",
        }}
        title={`Current: ${displayName}. Switch ERP Application or Return to Global Control Panel`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "#0284c7" }}
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
        <span>{displayName}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "38px",
            width: "280px",
            background: "#ffffff",
            borderRadius: "8px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            border: "1px solid #e2e8f0",
            zIndex: 99999,
            overflow: "hidden",
            padding: "6px",
          }}
        >
          <div
            style={{
              padding: "8px 10px 6px",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "#64748b",
              borderBottom: "1px solid #f1f5f9",
              marginBottom: "4px",
            }}
          >
            Connected Fleet Applications
          </div>

          {ECOSYSTEM_ERPS.map((erp) => {
            const isCurrent = erp.key === currentKey;
            return (
              <button
                key={erp.key}
                type="button"
                onClick={() => !isCurrent && handleSwitch(erp.hostUrl)}
                disabled={isCurrent}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "none",
                  background: isCurrent ? "#f8fafc" : "transparent",
                  color: isCurrent ? "#94a3b8" : "#1e293b",
                  cursor: isCurrent ? "default" : "pointer",
                  textAlign: "left",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) (e.currentTarget as HTMLElement).style.background = "#eff6ff";
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: isCurrent ? 600 : 700 }}>{erp.name}</div>
                  <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace" }}>
                    {erp.hostUrl.replace(/^https?:\/\//, "")}
                  </div>
                </div>
                {isCurrent ? (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      background: "#e2e8f0",
                      color: "#475569",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    Current
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      background: "#e0f2fe",
                      color: "#0369a1",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    Switch ↗
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
