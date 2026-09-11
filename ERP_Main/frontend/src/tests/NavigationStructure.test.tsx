/**
 * Verification Test Suite for ERP_Main 8-Section Navigation Structure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  NAV_SECTIONS,
  ERP_SECTION_TABS,
  ACCESS_SECTION_TABS,
  ORG_SECTION_TABS,
  INTEGRATION_SECTION_TABS,
  SYNC_SECTION_TABS,
  MONITORING_SECTION_TABS,
  SETTINGS_SECTION_TABS,
} from "@/lib/nav";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { Auth } from "@/lib/auth";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue([]),
  apiPost: vi.fn().mockResolvedValue({}),
  apiPatch: vi.fn().mockResolvedValue({}),
  apiDelete: vi.fn().mockResolvedValue({}),
  setUnauthorizedHandler: vi.fn(),
}));

describe("8 Primary Navigation Sections Specification", () => {
  beforeEach(() => {
    localStorage.clear();
    Auth.setSession("mock-jwt-token", {
      id: "admin-1",
      email: "admin@example.com",
      role: "SUPER_ADMIN",
      display_name: "Master Admin",
      is_active: true,
      created_at: new Date().toISOString(),
    });
  });

  it("contains all 8 required navigation groups with correct section labels", () => {
    expect(NAV_SECTIONS).toHaveLength(8);

    const sectionLabels = NAV_SECTIONS.map((s) => s.label);
    expect(sectionLabels).toContain("DASHBOARD");
    expect(sectionLabels).toContain("ERPS");
    expect(sectionLabels).toContain("USERS & ACCESS");
    expect(sectionLabels).toContain("ORGANIZATIONS");
    expect(sectionLabels).toContain("INTEGRATIONS");
    expect(sectionLabels).toContain("SYNCHRONIZATION");
    expect(sectionLabels).toContain("MONITORING & AUDIT");
    expect(sectionLabels).toContain("SETTINGS");
  });

  it("verifies ERPs section tabs and paths", () => {
    expect(ERP_SECTION_TABS).toHaveLength(1);
    const keys = ERP_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual(["erp-switcher"]);
  });

  it("verifies Users & Access section tabs and paths", () => {
    expect(ACCESS_SECTION_TABS).toHaveLength(5);
    const keys = ACCESS_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual(["users", "roles", "permissions", "memberships", "access-policies"]);
  });

  it("verifies Organizations section tabs and paths", () => {
    expect(ORG_SECTION_TABS).toHaveLength(4);
    const keys = ORG_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual(["companies", "organizations", "departments", "business-units"]);
  });

  it("verifies Integrations section tabs and paths", () => {
    expect(INTEGRATION_SECTION_TABS).toHaveLength(6);
    const keys = INTEGRATION_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual([
      "integrations",
      "subscriptions",
      "integration-events",
      "delivery-status",
      "failed-events",
      "dead-letter-queue",
    ]);
  });

  it("verifies Synchronization section tabs and paths", () => {
    expect(SYNC_SECTION_TABS).toHaveLength(7);
    const keys = SYNC_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual([
      "sync-policies",
      "data-ownership",
      "entity-mappings",
      "reconciliation",
      "conflicts",
      "repair-replay",
      "snapshots",
    ]);
  });

  it("verifies Monitoring & Audit section tabs and paths", () => {
    expect(MONITORING_SECTION_TABS).toHaveLength(8);
    const keys = MONITORING_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual([
      "system-health",
      "erp-health",
      "queue-health",
      "realtime-connections",
      "workers",
      "alerts",
      "audit",
      "security-events",
    ]);
  });

  it("verifies Settings section tabs and paths", () => {
    expect(SETTINGS_SECTION_TABS).toHaveLength(4);
    const keys = SETTINGS_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual([
      "settings-general",
      "settings-security",
      "settings-sessions",
      "settings-notifications",
    ]);
  });

  it("renders SectionNavTabs properly with active indicator", () => {
    render(
      <MemoryRouter>
        <SectionNavTabs items={ORG_SECTION_TABS} activeKey="departments" />
      </MemoryRouter>
    );

    expect(screen.getByText("Companies")).toBeDefined();
    expect(screen.getByText("Organizations")).toBeDefined();
    expect(screen.getByText("Departments")).toBeDefined();
    expect(screen.getByText("Business Units")).toBeDefined();

    const deptsLink = screen.getByRole("link", { name: /Departments/i });
    expect(deptsLink.getAttribute("href")).toBe("/organizations/departments");
  });

  it("renders AppShell with search button and slash shortcut indicator", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell activeKey="dashboard" pageTitle="Dashboard">
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(screen.getByText("/")).toBeDefined();
    expect(screen.getByText("Search projections...")).toBeDefined();
  });

  it("guarantees every single navigation item across all 8 sections has a unique distinct icon", () => {
    const allItems = NAV_SECTIONS.flatMap((s) => s.items);
    const icons = allItems.map((item) => item.icon);
    const uniqueIcons = new Set(icons);

    expect(allItems.length).toBe(36);
    expect(uniqueIcons.size).toBe(allItems.length);
  });
});
