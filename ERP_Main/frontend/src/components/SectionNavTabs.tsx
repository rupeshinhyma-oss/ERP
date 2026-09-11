/**
 * Reusable Section Sub-Navigation Tabs.
 *
 * Renders consistent horizontal sub-navigation tabs across all 8 control-plane
 * primary sections (ERPs, Access, Organizations, Integrations, Sync, Monitoring, Settings).
 */

import { Link } from "react-router-dom";
import { ICONS, type IconKey } from "./icons";

export interface SectionTabItem {
  key: string;
  label: string;
  path: string;
  icon?: IconKey;
  badge?: number | string;
}

interface SectionNavTabsProps {
  items: SectionTabItem[];
  activeKey: string;
}

export function SectionNavTabs({ items, activeKey }: SectionNavTabsProps) {
  return (
    <div
      className="section-nav-tabs"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        borderBottom: "1px solid var(--color-border, #e2e8f0)",
        marginBottom: "24px",
        overflowX: "auto",
        paddingBottom: "1px",
      }}
    >
      {items.map((tab) => {
        const isActive = tab.key === activeKey;
        const IconComponent = tab.icon ? ICONS[tab.icon] : null;

        return (
          <Link
            key={tab.key}
            to={tab.path}
            className={`section-tab-btn ${isActive ? "active" : ""}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              fontSize: "13px",
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--color-primary, #0061f2)" : "var(--color-text-secondary, #64748b)",
              borderBottom: isActive ? "2px solid var(--color-primary, #0061f2)" : "2px solid transparent",
              background: "transparent",
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            {IconComponent && <IconComponent style={{ width: "16px", height: "16px" }} />}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                style={{
                  fontSize: "11px",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  background: isActive ? "rgba(0, 97, 242, 0.12)" : "var(--color-bg-secondary, #f1f5f9)",
                  color: isActive ? "var(--color-primary, #0061f2)" : "var(--color-muted, #94a3b8)",
                  fontWeight: 600,
                }}
              >
                {tab.badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
