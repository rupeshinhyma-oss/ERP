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

export function IconBuilding(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </NavSvg>
  );
}

export function IconDatabase(props: IconProps) {
  return (
    <NavSvg {...props}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </NavSvg>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <NavSvg {...props}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </NavSvg>
  );
}

export function IconCpu(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </NavSvg>
  );
}

export function IconRadio(props: IconProps) {
  return (
    <NavSvg {...props}>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
    </NavSvg>
  );
}

export function IconPackage(props: IconProps) {
  return (
    <NavSvg {...props}>
      <line x1="16.5" y1="9.4" x2="7.55" y2="4.24" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </NavSvg>
  );
}

export function IconUserCheck(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <polyline points="17 11 19 13 23 9" />
    </NavSvg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </NavSvg>
  );
}

export function IconOrgChart(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="2" y="16" width="5" height="5" rx="1" />
      <rect x="9.5" y="16" width="5" height="5" rx="1" />
      <rect x="17" y="16" width="5" height="5" rx="1" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="4.5" y1="12" x2="19.5" y2="12" />
      <line x1="4.5" y1="12" x2="4.5" y2="16" />
      <line x1="12" y1="12" x2="12" y2="16" />
      <line x1="19.5" y1="12" x2="19.5" y2="16" />
    </NavSvg>
  );
}

export function IconBriefcase(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <line x1="2" y1="13" x2="22" y2="13" />
    </NavSvg>
  );
}

export function IconFactory(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4H2v16z" />
      <line x1="17" y1="18" x2="17.01" y2="18" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
      <line x1="7" y1="18" x2="7.01" y2="18" />
    </NavSvg>
  );
}

export function IconNetwork(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="5" y1="12" x2="19" y2="12" />
      <line x1="5" y1="12" x2="5" y2="16" />
      <line x1="19" y1="12" x2="19" y2="16" />
    </NavSvg>
  );
}

export function IconRss(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </NavSvg>
  );
}

export function IconZap(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </NavSvg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <NavSvg {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </NavSvg>
  );
}

export function IconAlertCircle(props: IconProps) {
  return (
    <NavSvg {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </NavSvg>
  );
}

export function IconArrowLeftRight(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="8 5 3 10 8 15" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <polyline points="16 19 21 14 16 9" />
      <line x1="21" y1="14" x2="3" y2="14" />
    </NavSvg>
  );
}

export function IconScale(props: IconProps) {
  return (
    <NavSvg {...props}>
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="4" y1="7" x2="20" y2="7" />
      <polyline points="4 7 1 14 7 14 4 7" />
      <polyline points="20 7 17 14 23 14 20 7" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </NavSvg>
  );
}

export function IconCamera(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </NavSvg>
  );
}

export function IconHeart(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </NavSvg>
  );
}

export function IconTerminal(props: IconProps) {
  return (
    <NavSvg {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </NavSvg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <NavSvg {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </NavSvg>
  );
}

export function IconMonitor(props: IconProps) {
  return (
    <NavSvg {...props}>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </NavSvg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <NavSvg {...props}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
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
  building: IconBuilding,
  database: IconDatabase,
  sliders: IconSliders,
  cpu: IconCpu,
  radio: IconRadio,
  package: IconPackage,
  userCheck: IconUserCheck,
  lock: IconLock,
  orgChart: IconOrgChart,
  briefcase: IconBriefcase,
  factory: IconFactory,
  network: IconNetwork,
  rss: IconRss,
  zap: IconZap,
  send: IconSend,
  alertCircle: IconAlertCircle,
  arrowLeftRight: IconArrowLeftRight,
  scale: IconScale,
  camera: IconCamera,
  heart: IconHeart,
  terminal: IconTerminal,
  globe: IconGlobe,
  monitor: IconMonitor,
  mail: IconMail,
};

export type IconKey = keyof typeof ICONS;

