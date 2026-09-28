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

  it("contains all required navigation groups with correct section labels", () => {
    expect(NAV_SECTIONS).toHaveLength(4);

    const sectionLabels = NAV_SECTIONS.map((s) => s.label);
    expect(sectionLabels).toContain("DASHBOARD");
    expect(sectionLabels).not.toContain("ERPS");
    expect(sectionLabels).toContain("USERS & ACCESS");
    expect(sectionLabels).not.toContain("ORGANIZATIONS");
    expect(sectionLabels).not.toContain("INTEGRATIONS");
    expect(sectionLabels).not.toContain("SYNCHRONIZATION");
    expect(sectionLabels).toContain("MONITORING & AUDIT");
    expect(sectionLabels).toContain("SETTINGS");
  });

  it("verifies ERPs section is removed from sidebar tabs", () => {
    expect(ERP_SECTION_TABS).toHaveLength(0);
  });

  it("verifies Users & Access section tabs and paths", () => {
    expect(ACCESS_SECTION_TABS).toHaveLength(3);
    const keys = ACCESS_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual(["users", "roles", "permissions"]);
  });

  it("verifies Organizations section is removed from sidebar tabs", () => {
    expect(ORG_SECTION_TABS).toHaveLength(0);
  });

  it("verifies Integrations section is removed from sidebar tabs", () => {
    expect(INTEGRATION_SECTION_TABS).toHaveLength(0);
  });

  it("verifies Synchronization section is removed from sidebar tabs", () => {
    expect(SYNC_SECTION_TABS).toHaveLength(0);
  });

  it("verifies Monitoring & Audit section tabs and paths", () => {
    expect(MONITORING_SECTION_TABS).toHaveLength(1);
    const keys = MONITORING_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual(["audit"]);
  });

  it("verifies Settings section tabs and paths", () => {
    expect(SETTINGS_SECTION_TABS).toHaveLength(1);
    const keys = SETTINGS_SECTION_TABS.map((t) => t.key);
    expect(keys).toEqual(["settings-general"]);
  });

  it("renders SectionNavTabs properly with active indicator", () => {
    render(
      <MemoryRouter>
        <SectionNavTabs items={ACCESS_SECTION_TABS} activeKey="roles" />
      </MemoryRouter>
    );

    expect(screen.getByText("Global Users")).toBeDefined();
    expect(screen.getByText("Roles")).toBeDefined();
    expect(screen.getByText("Permissions")).toBeDefined();
    expect(screen.queryByText("ERP Memberships")).toBeNull();

    const rolesLink = screen.getByRole("link", { name: /Roles/i });
    expect(rolesLink.getAttribute("href")).toBe("/access/roles");
  });

  it("renders AppShell with ERP Switcher dropdown button", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell activeKey="dashboard" pageTitle="Dashboard">
          <div>Content</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(document.getElementById("header-erp-switcher-btn")?.textContent).toContain("ERP Dashboard");
    expect(screen.queryByText("Search projections...")).toBeNull();
  });

  it("guarantees every single navigation item across all sections has a unique distinct icon", () => {
    const allItems = NAV_SECTIONS.flatMap((s) => s.items);
    const icons = allItems.map((item) => item.icon);
    const uniqueIcons = new Set(icons);

    expect(allItems.length).toBe(4);
    expect(uniqueIcons.size).toBe(allItems.length);
  });
});
