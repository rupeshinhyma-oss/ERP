/**
 * SVG Icons for ERP_Main Control Plane.
 *
 * Matching the exact stroke, fill, and styling rules of Yinglima and Inhyma.
 */

import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function NavSvg({ children, className = "nav-icon", ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...stroke} className={className} {...rest}>
      {children}
    </svg>
  );
}

export function IconDashboard(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </NavSvg>
  );
}

export function IconServer(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </NavSvg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </NavSvg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </NavSvg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </NavSvg>
  );
}

export function IconAlertTriangle(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </NavSvg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </NavSvg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </NavSvg>
  );
}

export function IconFileText(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </NavSvg>
  );
}

export function IconBarChart(props: IconProps) {
  return (
    <NavSvg {...props}>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </NavSvg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <NavSvg {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </NavSvg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <NavSvg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </NavSvg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </NavSvg>
  );
}

export function IconExternalLink(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </NavSvg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </NavSvg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="20 6 9 17 4 12" />
    </NavSvg>
  );
}

export function IconX(props: IconProps) {
  return (
    <NavSvg {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </NavSvg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <NavSvg {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </NavSvg>
  );
}

export function IconEye(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </NavSvg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </NavSvg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="6 9 12 15 18 9" />
    </NavSvg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="9 18 15 12 9 6" />
    </NavSvg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="15 18 9 12 15 6" />
    </NavSvg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </NavSvg>
  );
}

export function IconKey(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="m21 2-2 2m-1.5 1.5L14 9a5 5 0 1 0 4 4l3.5-3.5" />
      <circle cx="7.5" cy="16.5" r="2.5" />
    </NavSvg>
  );
}

export const ICONS = {
  dashboard: IconDashboard,
  server: IconServer,
  layers: IconLayers,
  users: IconUsers,
  user: IconUsers,
  link: IconLink,
  alertTriangle: IconAlertTriangle,
  alert: IconAlertTriangle,
  shield: IconShield,
  activity: IconActivity,
  fileText: IconFileText,
  barChart: IconBarChart,
  search: IconSearch,
  settings: IconSettings,
  bell: IconBell,
  externalLink: IconExternalLink,
  refresh: IconRefresh,
  refreshCw: IconRefresh,
  check: IconCheck,
  x: IconX,
  plus: IconPlus,
  eye: IconEye,
  trash: IconTrash,
  chevronDown: IconChevronDown,
  chevronRight: IconChevronRight,
  chevronLeft: IconChevronLeft,
  copy: IconCopy,
  key: IconKey,
};

export type IconKey = keyof typeof ICONS;

