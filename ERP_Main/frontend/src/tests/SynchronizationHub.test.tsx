/**
 * Test Suite for SynchronizationHub Component in ERP_Main.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SynchronizationHub } from "@/pages/SynchronizationHub";
import { Auth } from "@/lib/auth";
import { GlobalSessionProvider } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

describe("SynchronizationHub Page Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Auth.setSession("mock-admin-token", {
      id: "admin-id",
      display_name: "Platform SuperAdmin",
      email: "admin@erp-main.local",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });
  });

  it("renders sync policies tab and authoritative architecture banner", async () => {
    vi.mocked(api.apiGet).mockImplementation((path: string) => {
      if (path.includes("/global/sync-policies")) {
        return Promise.resolve([
          {
            id: "pol-1",
            entity_type: "buyer",
            source_erp_id: "erp-1",
            target_erp_id: "erp-2",
            ownership_strategy: "SOURCE_AUTHORITATIVE",
            direction: "UNIDIRECTIONAL",
            conflict_strategy: "SOURCE_WINS",
            is_active: true,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      if (path.includes("/global/erps")) {
        return Promise.resolve([
          {
            id: "erp-1",
            name: "Yinglima ERP",
            erp_key: "yinglima",
            status: "ACTIVE",
            version: "1.0.0",
            base_url: "http://localhost:5173",
            capabilities: ["buyers"],
            created_at: new Date().toISOString(),
          },
          {
            id: "erp-2",
            name: "Inhyma ERP",
            erp_key: "inhyma",
            status: "ACTIVE",
            version: "1.0.0",
            base_url: "http://localhost:5174",
            capabilities: ["suppliers"],
            created_at: new Date().toISOString(),
          },
        ]);
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter initialEntries={["/sync/policies"]}>
        <GlobalSessionProvider>
          <ToastProvider>
            <SynchronizationHub />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Decentralized Synchronization & Ownership Control")).toBeDefined();
      expect(screen.getByText("SOURCE_AUTHORITATIVE")).toBeDefined();
    });

    expect(screen.getByText("Create Sync Policy")).toBeDefined();
  });

  it("renders data ownership matrix with primary nodes", async () => {
    vi.mocked(api.apiGet).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/sync/ownership"]}>
        <GlobalSessionProvider>
          <ToastProvider>
            <SynchronizationHub />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Authoritative Ownership Matrix")).toBeDefined();
      expect(screen.getByText("Yinglima ERP (Apparel Master)")).toBeDefined();
      expect(screen.getByText("Inhyma ERP (Sourcing Master)")).toBeDefined();
    });
  });
});
