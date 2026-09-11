import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Memberships } from "../pages/Memberships";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("Memberships Page", () => {
  const mockUsers = [
    {
      id: "u-1",
      display_name: "Alice Wang",
      primary_email: "alice@company.com",
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];

  const mockErps = [
    {
      id: "erp-1",
      erp_key: "YINGLIMA_TEST",
      name: "Yinglima ERP",
      status: "ACTIVE",
      version: "2.1.0",
      base_url: "http://localhost:8000",
      capabilities: ["SSO"],
      created_at: "2026-01-01T00:00:00Z",
    },
  ];

  const mockMemberships = [
    {
      id: "mem-1",
      global_user_id: "u-1",
      erp_instance_id: "erp-1",
      local_user_id: "local-uuid-1234",
      status: "PENDING",
      verified_at: null,
      created_at: "2026-01-01T00:00:00Z",
      user_email: "alice@company.com",
      user_display_name: "Alice Wang",
      erp_name: "Yinglima ERP",
      erp_key: "YINGLIMA_TEST",
    },
    {
      id: "mem-2",
      global_user_id: "u-1",
      erp_instance_id: "erp-1",
      local_user_id: "local-uuid-5678",
      status: "ACTIVE",
      verified_at: "2026-01-02T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      user_email: "alice@company.com",
      user_display_name: "Alice Wang",
      erp_name: "Yinglima ERP",
      erp_key: "YINGLIMA_TEST",
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    Auth.setSession("test-token", {
      id: "admin-1",
      email: "admin@platform.local",
      display_name: "Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });
    vi.restoreAllMocks();
  });

  it("renders memberships list, architecture banner, and metrics", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/memberships")) return Promise.resolve(mockMemberships);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Memberships />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Decoupled Identity & Authoritative Local RBAC Architecture")).toBeDefined();
      expect(screen.getByText("local-uuid-1234")).toBeDefined();
      expect(screen.getByText("local-uuid-5678")).toBeDefined();
    });

    // Check actions for pending vs active
    expect(screen.getByText("Verify")).toBeDefined();
    expect(screen.getByText("Suspend")).toBeDefined();
  });

  it("opens link modal and submits new membership link", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/memberships")) return Promise.resolve(mockMemberships);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      return Promise.resolve([]);
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      id: "mem-3",
      global_user_id: "u-1",
      erp_instance_id: "erp-1",
      local_user_id: "local-uuid-9999",
      status: "PENDING",
    });

    render(
      <MemoryRouter>
        <Memberships />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("local-uuid-1234")).toBeDefined();
    });

    const linkBtn = screen.getByText("Link Membership");
    fireEvent.click(linkBtn);

    expect(screen.getByText("Link Global User to Local ERP Account")).toBeDefined();

    // Fill form
    const userSelect = screen.getByLabelText(/Global User Identity/i);
    const erpSelect = screen.getByLabelText(/Target ERP Instance/i);
    const localIdInput = screen.getByLabelText(/Local ERP User ID/i);

    fireEvent.change(userSelect, { target: { value: "u-1" } });
    fireEvent.change(erpSelect, { target: { value: "erp-1" } });
    fireEvent.change(localIdInput, { target: { value: "local-uuid-9999" } });

    const submitBtn = screen.getByRole("button", { name: "Establish Membership" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/identity/link", {
        global_user_id: "u-1",
        erp_instance_id: "erp-1",
        local_user_id: "local-uuid-9999",
      });
    });
  });

  it("triggers safe unlink flow with architectural notice", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/memberships")) return Promise.resolve([mockMemberships[0]]);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      return Promise.resolve([]);
    });

    const deleteSpy = vi.spyOn(apiModule, "apiDelete").mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <Memberships />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("local-uuid-1234")).toBeDefined();
    });

    const unlinkBtns = screen.getAllByText("Unlink");
    fireEvent.click(unlinkBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Safe Unlink Architecture:/i)).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", { name: "Unlink Membership" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("/global/identity/memberships/mem-1/link");
    });
  });
});
