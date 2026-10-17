import React, { useState, useMemo } from "react";
import type { Permission } from "@/types";
import {
  MODULE_NAMES,
  MODULE_ICONS,
  PERMISSION_SECTIONS,
  friendlyPermissionLabel,
  friendlyActionIcon,
  groupPermissionsByModule,
} from "@/lib/permissionLabels";

export interface PermissionMatrixEditorProps {
  allPermissions: Permission[];
  checkedCodes: Set<string>;
  onToggleCode: (code: string) => void;
  onSelectAllInModule: (modKey: string, selectAll: boolean) => void;
  onSelectAllInSection: (sectionId: string, selectAll: boolean) => void;
  onSetAllCodes: (codes: Set<string>) => void;
  rolePermissions?: Set<string>; // if provided, enables User Overrides mode
  isReadOnly?: boolean;
}

type TabFilter = "all" | "core" | "inventory" | "admin" | "masters" | "overridden";

export const PermissionMatrixEditor: React.FC<PermissionMatrixEditorProps> = ({
  allPermissions,
  checkedCodes,
  onToggleCode,
  onSelectAllInModule,
  onSelectAllInSection,
  onSetAllCodes,
  rolePermissions,
  isReadOnly = false,
}) => {
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [search, setSearch] = useState("");
  // Collapsed sections tracking
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    masters: false,
  });

  const isUserOverridesMode = Boolean(rolePermissions);
  const roleGranted = useMemo(() => rolePermissions || new Set<string>(), [rolePermissions]);

  // Group permissions by module
  const moduleGroups = useMemo(() => groupPermissionsByModule(allPermissions), [allPermissions]);

  // Count overridden permissions
  const overriddenCount = useMemo(() => {
    if (!isUserOverridesMode) return 0;
    let count = 0;
    for (const p of allPermissions) {
      const isChecked = checkedCodes.has(p.code);
      const isRole = roleGranted.has(p.code);
      if (isChecked !== isRole) count++;
    }
    return count;
  }, [allPermissions, checkedCodes, roleGranted, isUserOverridesMode]);

  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const expandAllSections = () => {
    setCollapsedSections({});
  };

  const collapseAllSections = () => {
    const collapsed: Record<string, boolean> = {};
    for (const s of PERMISSION_SECTIONS) collapsed[s.id] = true;
    setCollapsedSections(collapsed);
  };

  // Filter sections and modules based on tab and search
  const q = search.trim().toLowerCase();

  const renderedSections = useMemo(() => {
    return PERMISSION_SECTIONS.map((section) => {
      // Filter modules belonging to this section
      let mods = section.modules.filter((modKey) => Boolean(moduleGroups[modKey]));

      // Filter by tab
      if (activeTab !== "all" && activeTab !== "overridden" && activeTab !== section.id) {
        return null;
      }

      // Filter by search query
      if (q) {
        mods = mods.filter((modKey) => {
          const modName = MODULE_NAMES[modKey] || modKey;
          const items = moduleGroups[modKey] || [];
          return (
            modName.toLowerCase().includes(q) ||
            modKey.toLowerCase().includes(q) ||
            items.some(
              (p) =>
                p.code.toLowerCase().includes(q) ||
                (p.description || "").toLowerCase().includes(q) ||
                friendlyPermissionLabel(p.code).toLowerCase().includes(q)
            )
          );
        });
      }

      // Filter by "overridden only" tab
      if (activeTab === "overridden" && isUserOverridesMode) {
        mods = mods.filter((modKey) => {
          const items = moduleGroups[modKey] || [];
          return items.some((p) => checkedCodes.has(p.code) !== roleGranted.has(p.code));
        });
      }

      if (mods.length === 0) return null;

      // Section total and active count
      let sectionTotal = 0;
      let sectionActive = 0;
      for (const m of mods) {
        const items = moduleGroups[m] || [];
        sectionTotal += items.length;
        sectionActive += items.filter((p) => checkedCodes.has(p.code)).length;
      }

      return {
        ...section,
        matchingModules: mods,
        sectionTotal,
        sectionActive,
      };
    }).filter(Boolean);
  }, [moduleGroups, activeTab, q, isUserOverridesMode, checkedCodes, roleGranted]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* 1. Category Filter Pills */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          flexWrap: "wrap",
          paddingBottom: "4px",
          borderBottom: "1px solid #f1f5f9",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("all")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 12px",
            borderRadius: "20px",
            fontSize: "12.5px",
            fontWeight: 600,
            cursor: "pointer",
            border: activeTab === "all" ? "1px solid #0061f2" : "1px solid #e2e8f0",
            background: activeTab === "all" ? "#0061f2" : "#ffffff",
            color: activeTab === "all" ? "#ffffff" : "#475569",
            transition: "all 0.15s ease",
          }}
        >
          <span>🌐 All Modules</span>
          <span
            style={{
              fontSize: "11px",
              padding: "1px 6px",
              borderRadius: "10px",
              background: activeTab === "all" ? "rgba(255,255,255,0.25)" : "#f1f5f9",
              color: activeTab === "all" ? "#ffffff" : "#64748b",
            }}
          >
            26
          </span>
        </button>

        {PERMISSION_SECTIONS.map((sec) => {
          const isActive = activeTab === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveTab(sec.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "20px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                border: isActive ? "1px solid #0061f2" : "1px solid #e2e8f0",
                background: isActive ? "#0061f2" : "#ffffff",
                color: isActive ? "#ffffff" : "#475569",
                transition: "all 0.15s ease",
              }}
            >
              <span>{sec.icon} {sec.title.split("&")[0].trim()}</span>
              <span
                style={{
                  fontSize: "11px",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  background: isActive ? "rgba(255,255,255,0.25)" : "#f1f5f9",
                  color: isActive ? "#ffffff" : "#64748b",
                }}
              >
                {sec.modules.length}
              </span>
            </button>
          );
        })}

        {isUserOverridesMode && (
          <button
            type="button"
            onClick={() => setActiveTab("overridden")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "20px",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
              border: activeTab === "overridden" ? "1px solid #d97706" : "1px solid #fed7aa",
              background: activeTab === "overridden" ? "#f59e0b" : "#fffbeb",
              color: activeTab === "overridden" ? "#ffffff" : "#b45309",
              transition: "all 0.15s ease",
            }}
          >
            <span>⭐ Overridden Only</span>
            <span
              style={{
                fontSize: "11px",
                padding: "1px 6px",
                borderRadius: "10px",
                background: activeTab === "overridden" ? "rgba(255,255,255,0.25)" : "#fef3c7",
                color: activeTab === "overridden" ? "#ffffff" : "#92400e",
                fontWeight: 700,
              }}
            >
              {overriddenCount}
            </span>
          </button>
        )}
      </div>

      {/* 2. Search & Global Actions Toolbar */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: "240px" }}>
          <input
            type="text"
            placeholder="🔍 Search permission, action or code..."
            style={{
              width: "100%",
              padding: "7px 30px 7px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              fontSize: "13px",
              background: "#ffffff",
              boxSizing: "border-box",
            }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          {!isReadOnly && (
            <>
              <button
                type="button"
                className="btn btn-small"
                style={{ background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", fontWeight: 600, fontSize: "12px", padding: "5px 10px" }}
                onClick={() => onSetAllCodes(new Set(allPermissions.map((p) => p.code)))}
              >
                🟢 Grant All
              </button>
              <button
                type="button"
                className="btn btn-small"
                style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", fontWeight: 600, fontSize: "12px", padding: "5px 10px" }}
                onClick={() => onSetAllCodes(new Set())}
              >
                🔴 Deny All
              </button>
              {isUserOverridesMode && (
                <button
                  type="button"
                  className="btn btn-small"
                  style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontWeight: 600, fontSize: "12px", padding: "5px 10px" }}
                  onClick={() => onSetAllCodes(new Set(roleGranted))}
                >
                  🔄 Reset to Dept
                </button>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: "4px", marginLeft: "4px" }}>
            <button
              type="button"
              className="btn btn-small"
              style={{ background: "#f8fafc", color: "#64748b", border: "1px solid #cbd5e1", fontSize: "11px", padding: "5px 8px" }}
              onClick={expandAllSections}
              title="Expand all sections"
            >
              ↕️ Expand All
            </button>
            <button
              type="button"
              className="btn btn-small"
              style={{ background: "#f8fafc", color: "#64748b", border: "1px solid #cbd5e1", fontSize: "11px", padding: "5px 8px" }}
              onClick={collapseAllSections}
              title="Collapse all sections"
            >
              ↔️ Collapse All
            </button>
          </div>
        </div>
      </div>

      {/* 3. Rendered Sections */}
      {renderedSections.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8", background: "#f8fafc", borderRadius: "8px", border: "1px dashed #cbd5e1" }}>
          No permissions found matching "{search}".
        </div>
      ) : (
        renderedSections.map((sec) => {
          if (!sec) return null;
          const isCollapsed = Boolean(collapsedSections[sec.id]);
          const allSectionChecked = sec.sectionActive === sec.sectionTotal && sec.sectionTotal > 0;

          return (
            <div
              key={sec.id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                background: "#ffffff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                overflow: "hidden",
              }}
            >
              {/* Section Header Accordion Bar */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 16px",
                  background: isCollapsed ? "#f8fafc" : "#f1f5f9",
                  borderBottom: isCollapsed ? "none" : "1px solid #e2e8f0",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                onClick={() => toggleSectionCollapse(sec.id)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "16px", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s ease", color: "#64748b" }}>
                    ▼
                  </span>
                  <span style={{ fontSize: "16px" }}>{sec.icon}</span>
                  <div>
                    <span style={{ fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                      {sec.title}
                    </span>
                    <span style={{ fontSize: "12px", color: "#64748b", marginLeft: "8px" }}>
                      ({sec.matchingModules.length} module{sec.matchingModules.length === 1 ? "" : "s"})
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }} onClick={(e) => e.stopPropagation()}>
                  <span
                    style={{
                      fontSize: "11.5px",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontWeight: 600,
                      background: allSectionChecked ? "#dcfce7" : sec.sectionActive > 0 ? "#e0e7ff" : "#f1f5f9",
                      color: allSectionChecked ? "#15803d" : sec.sectionActive > 0 ? "#4338ca" : "#64748b",
                    }}
                  >
                    {sec.sectionActive} / {sec.sectionTotal} active
                  </span>

                  {!isReadOnly && (
                    <button
                      type="button"
                      className="btn btn-small"
                      style={{
                        padding: "3px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        background: "#ffffff",
                        border: "1px solid #cbd5e1",
                        color: "#334155",
                      }}
                      onClick={() => onSelectAllInSection(sec.id, !allSectionChecked)}
                    >
                      {allSectionChecked ? "Deselect Section" : "Select Section"}
                    </button>
                  )}
                </div>
              </div>

              {/* Section Body (Modules) */}
              {!isCollapsed && (
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {sec.matchingModules.map((modKey) => {
                    let items = moduleGroups[modKey] || [];
                    if (q) {
                      items = items.filter(
                        (p) =>
                          p.code.toLowerCase().includes(q) ||
                          (p.description || "").toLowerCase().includes(q) ||
                          friendlyPermissionLabel(p.code).toLowerCase().includes(q)
                      );
                    }
                    if (activeTab === "overridden" && isUserOverridesMode) {
                      items = items.filter((p) => checkedCodes.has(p.code) !== roleGranted.has(p.code));
                    }
                    if (items.length === 0) return null;

                    const allCheckedInMod = items.every((p) => checkedCodes.has(p.code));
                    const checkedCountInMod = items.filter((p) => checkedCodes.has(p.code)).length;
                    const modIcon = MODULE_ICONS[modKey] || "📁";
                    const modName = MODULE_NAMES[modKey] || modKey.toUpperCase();

                    return (
                      <div
                        key={modKey}
                        style={{
                          background: "#fafbfc",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          padding: "10px 12px",
                        }}
                      >
                        {/* Module Header */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "10px",
                            paddingBottom: "6px",
                            borderBottom: "1px solid #edf2f7",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "14px" }}>{modIcon}</span>
                            <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
                              {modName}
                            </span>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "1px 6px",
                                borderRadius: "8px",
                                background: allCheckedInMod ? "#dcfce7" : checkedCountInMod > 0 ? "#e0edff" : "#f1f5f9",
                                color: allCheckedInMod ? "#166534" : checkedCountInMod > 0 ? "#0061f2" : "#64748b",
                              }}
                            >
                              {checkedCountInMod} / {items.length} active
                            </span>
                          </div>

                          {!isReadOnly && (
                            <button
                              type="button"
                              style={{
                                background: "none",
                                border: "1px solid #cbd5e1",
                                borderRadius: "4px",
                                padding: "2px 8px",
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "#0061f2",
                                cursor: "pointer",
                              }}
                              onClick={() => onSelectAllInModule(modKey, !allCheckedInMod)}
                            >
                              {allCheckedInMod ? "Deselect All" : "Select All"}
                            </button>
                          )}
                        </div>

                        {/* Action Badges / Checkboxes Grid */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                            gap: "8px",
                          }}
                        >
                          {items.map((p) => {
                            const isChecked = checkedCodes.has(p.code);
                            const isRole = isUserOverridesMode ? roleGranted.has(p.code) : false;
                            const isExtraGrant = isUserOverridesMode && isChecked && !isRole;
                            const isDirectDeny = isUserOverridesMode && !isChecked && isRole;
                            const isDeptInherited = isUserOverridesMode && isChecked && isRole;
                            const actionIcon = friendlyActionIcon(p.code);
                            const label = friendlyPermissionLabel(p.code);

                            // Background and border colors based on state
                            let cardBg = "#ffffff";
                            let cardBorder = "#e2e8f0";
                            if (isChecked) {
                              if (isExtraGrant) {
                                cardBg = "#f0fdf4";
                                cardBorder = "#86efac";
                              } else if (isDeptInherited) {
                                cardBg = "#eff6ff";
                                cardBorder = "#bfdbfe";
                              } else {
                                cardBg = "#f0fdf4";
                                cardBorder = "#bbf7d0";
                              }
                            } else if (isDirectDeny) {
                              cardBg = "#fef2f2";
                              cardBorder = "#fca5a5";
                            }

                            return (
                              <label
                                key={p.code}
                                title={`${p.code}\n${p.description || ""}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  padding: "6px 8px",
                                  borderRadius: "6px",
                                  border: `1px solid ${cardBorder}`,
                                  background: cardBg,
                                  cursor: isReadOnly ? "default" : "pointer",
                                  transition: "all 0.12s ease",
                                  userSelect: "none",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={isReadOnly}
                                  onChange={() => onToggleCode(p.code)}
                                  style={{
                                    width: "15px",
                                    height: "15px",
                                    accentColor: "#0061f2",
                                    cursor: isReadOnly ? "default" : "pointer",
                                    margin: 0,
                                  }}
                                />
                                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px" }}>
                                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#1e293b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {actionIcon} {label}
                                    </span>
                                    {isExtraGrant && (
                                      <span
                                        style={{
                                          fontSize: "9px",
                                          fontWeight: 700,
                                          padding: "1px 4px",
                                          borderRadius: "3px",
                                          background: "#dcfce7",
                                          color: "#15803d",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        + EXTRA
                                      </span>
                                    )}
                                    {isDirectDeny && (
                                      <span
                                        style={{
                                          fontSize: "9px",
                                          fontWeight: 700,
                                          padding: "1px 4px",
                                          borderRadius: "3px",
                                          background: "#fee2e2",
                                          color: "#b91c1c",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        ✕ DENIED
                                      </span>
                                    )}
                                  </div>
                                  <span style={{ fontSize: "10px", color: "#64748b", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {p.code.split(".").slice(1).join(".") || p.code}
                                  </span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
