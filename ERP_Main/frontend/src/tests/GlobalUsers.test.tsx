import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalUsers } from "../pages/GlobalUsers";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("GlobalUsers Page", () => {
  const mockUsers = [
    {
      id: "u-1",
      display_name: "Alice Wang",
      primary_email: "alice@company.com",
      status: "ACTIVE",
      external_identity_id: "EXT-001",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "u-2",
      display_name: "Bob Smith",
      primary_email: "bob@company.com",
      status: "SUSPENDED",
      external_identity_id: null,
      created_at: "2026-01-02T00:00:00Z",
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

  beforeEach(() => {
    localStorage.clear();
    Auth.setSession("test-token", {
      id: "admin-1",
      email: "admin@example.com",
      display_name: "Platform Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });
    vi.restoreAllMocks();
  });

  it("renders global users table and statistics accurately", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) {
        return Promise.resolve(mockUsers);
      }
      if (url.includes("/global/erps")) {
        return Promise.resolve(mockErps);
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Wang")).toBeDefined();
      expect(screen.getByText("alice@company.com")).toBeDefined();
      expect(screen.getByText("Bob Smith")).toBeDefined();
      expect(screen.getByText("bob@company.com")).toBeDefined();
    });

    // Check status badges
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Suspended").length).toBeGreaterThan(0);


    // Check action buttons
    expect(screen.getAllByText("View").length).toBeGreaterThan(0);
  });


  it("filters users by search query", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Wang")).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText("Search by name, email or ID...");
    fireEvent.change(searchInput, { target: { value: "Bob" } });

    expect(screen.queryByText("Alice Wang")).toBeNull();
    expect(screen.getByText("Bob Smith")).toBeDefined();
  });

  it("opens create user modal and submits with primary_email", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      id: "u-3",
      display_name: "Charlie Brown",
      primary_email: "charlie@company.com",
      status: "ACTIVE",
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Wang")).toBeDefined();
    });

    // Click "Create Global User"
    const newBtn = screen.getByText("Create Global User");
    fireEvent.click(newBtn);


    expect(screen.getByRole("heading", { name: "Create Global User" })).toBeDefined();

    // Fill form
    const nameInput = screen.getByLabelText(/Full Name/i);
    const emailInput = screen.getByLabelText(/Primary Email/i);

    fireEvent.change(nameInput, { target: { value: "Charlie Brown" } });
    fireEvent.change(emailInput, { target: { value: "charlie@company.com" } });

    const submitBtn = screen.getByRole("button", { name: "Create User" });
    fireEvent.click(submitBtn);


    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/users", {
        display_name: "Charlie Brown",
        primary_email: "charlie@company.com",
        external_identity_id: null,
      });
    });
  });

  it("opens detail drawer and displays Ecosystem Footprint with linked ERPs and roles", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users?")) return Promise.resolve(mockUsers);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/memberships")) {
        return Promise.resolve([
          {
            id: "mem-1",
            global_user_id: "u-1",
            erp_instance_id: "erp-1",
            local_user_id: "loc-999",
            status: "ACTIVE",
            created_at: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      if (url.includes("/roles")) {
        return Promise.resolve([
          {
            id: "assign-1",
            global_user_id: "u-1",
            role_id: "r-1",
            role_key: "PLATFORM_ADMIN",
            scope: "GLOBAL",
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Wang")).toBeDefined();
    });

    // Click "View" on Alice Wang
    const viewBtns = screen.getAllByText("View");
    fireEvent.click(viewBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("Global User: Alice Wang")).toBeDefined();
      expect(screen.getByText("Ecosystem Footprint")).toBeDefined();
      expect(screen.getByText(/Linked ERPs/i)).toBeDefined();
      expect(screen.getByText(/Platform Roles/i)).toBeDefined();
      expect(screen.getByText("PLATFORM_ADMIN")).toBeDefined();
      expect(screen.getAllByText("Edit Profile").length).toBeGreaterThan(0);
    });
  });

  it("renders only View for Super Admin (no Disable) and displays Full System Access with Edit in drawer", async () => {
    const adminUser = {
      id: "u-admin",
      display_name: "Super Admin",
      primary_email: "admin@example.com",
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users?")) return Promise.resolve([adminUser]);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/memberships")) {
        return Promise.resolve([
          {
            id: "mem-admin-1",
            global_user_id: "u-admin",
            erp_instance_id: "erp-1",
            local_user_id: "loc-admin",
            status: "ACTIVE",
            created_at: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      if (url.includes("/roles")) {
        return Promise.resolve([
          {
            id: "assign-admin",
            global_user_id: "u-admin",
            role_id: "r-admin",
            role_key: "SUPER_ADMIN",
            scope: "GLOBAL",
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Super Admin")).toBeDefined();
    });

    // For Admin: row only has View button, no Disable button
    expect(screen.getByText("View")).toBeDefined();
    expect(screen.queryByText("Disable")).toBeNull();

    // Open View
    fireEvent.click(screen.getByText("View"));

    await waitFor(() => {
      expect(screen.getByText("Global User: Super Admin")).toBeDefined();
      expect(screen.getAllByText("Edit Profile").length).toBeGreaterThan(0);
      expect(screen.getByText(/Protected Platform Administrator/i)).toBeDefined();
      expect(screen.getByText("Ecosystem Footprint")).toBeDefined();
    });
  });

  it("shows View and red painted Disable button for added regular users", async () => {
    const regularUser = {
      id: "u-regular",
      display_name: "Regular Operator",
      primary_email: "operator@company.com",
      status: "ACTIVE",
      created_at: "2026-01-01T00:00:00Z",
    };

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users?")) return Promise.resolve([regularUser]);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/memberships")) {
        return Promise.resolve([
          {
            id: "mem-reg-1",
            global_user_id: "u-regular",
            erp_instance_id: "erp-1",
            local_user_id: "loc-reg-1",
            status: "ACTIVE",
            created_at: "2026-01-01T00:00:00Z",
          },
        ]);
      }
      if (url.includes("/roles")) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Regular Operator")).toBeDefined();
    });

    // For regular users: has View AND Disable buttons
    expect(screen.getByText("View")).toBeDefined();
    expect(screen.getByText("Disable")).toBeDefined();

    // Open View
    fireEvent.click(screen.getByText("View"));

    await waitFor(() => {
      expect(screen.getByText("Global User: Regular Operator")).toBeDefined();
      expect(screen.getAllByText("Edit Profile").length).toBeGreaterThan(0);
      expect(screen.getByText("Ecosystem Footprint")).toBeDefined();
    });
  });

  it("creates a global user with initial Yinglima and Inhyma provisioning options", async () => {
    const spokeErps = [
      { id: "erp-yinglima", erp_key: "yinglima-erp", name: "Yinglima ERP", status: "ACTIVE" },
      { id: "erp-inhyma", erp_key: "inhyma-erp", name: "Inhyma ERP", status: "ACTIVE" },
    ];

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) return Promise.resolve([]);
      if (url.includes("/global/erps")) return Promise.resolve(spokeErps);
      return Promise.resolve([]);
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockImplementation((url: string) => {
      if (url === "/global/users") {
        return Promise.resolve({
          id: "u-new-1",
          display_name: "Diana Prince",
          primary_email: "diana@wonder.com",
          status: "ACTIVE",
        });
      }
      if (url.includes("/provision")) {
        return Promise.resolve({
          membership_id: "mem-prov-1",
          status: "ACTIVE",
          sync_status: "SYNCHRONIZED",
        });
      }
      return Promise.resolve({});
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText("Create Global User").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("Create Global User")[0]);

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: "Diana Prince" } });
    fireEvent.change(screen.getByLabelText(/Primary Email/i), { target: { value: "diana@wonder.com" } });

    // Check Yinglima and Inhyma provisioning checkboxes
    const yinglimaCheckbox = screen.getByLabelText(/Grant Yinglima ERP access/i);
    const inhymaCheckbox = screen.getByLabelText(/Grant Inhyma ERP access/i);
    fireEvent.click(yinglimaCheckbox);
    fireEvent.click(inhymaCheckbox);

    fireEvent.click(screen.getByRole("button", { name: "Create User" }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/users", expect.objectContaining({
        display_name: "Diana Prince",
        primary_email: "diana@wonder.com",
      }));
      expect(postSpy).toHaveBeenCalledWith("/global/users/u-new-1/provision", { erp_instance_id: "erp-yinglima" });
      expect(postSpy).toHaveBeenCalledWith("/global/users/u-new-1/provision", { erp_instance_id: "erp-inhyma" });
    });
  });

  it("handles ERP access management: grants access via Edit modal", async () => {
    const testUser = {
      id: "u-multi",
      display_name: "Multi ERP User",
      primary_email: "multi@example.com",
      status: "ACTIVE",
    };
    const spokeErps = [
      { id: "erp-yinglima", erp_key: "yinglima-erp", name: "Yinglima ERP", status: "ACTIVE" },
      { id: "erp-inhyma", erp_key: "inhyma-erp", name: "Inhyma ERP", status: "ACTIVE" },
    ];

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users?")) return Promise.resolve([testUser]);
      if (url.includes("/global/erps")) return Promise.resolve(spokeErps);
      if (url.includes("/memberships")) return Promise.resolve([]);
      if (url.includes("/conflicts")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    vi.spyOn(apiModule, "apiPatch").mockResolvedValue({
      ...testUser,
    });

    const postSpy = vi.spyOn(apiModule, "apiPost").mockImplementation((url: string) => {
      if (url.includes("/provision")) {
        return Promise.resolve({ membership_id: "mem-inhyma", status: "ACTIVE" });
      }
      return Promise.resolve({});
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Multi ERP User")).toBeDefined();
    });

    // Open Edit directly from table
    const editBtns = screen.getAllByText("Edit");
    fireEvent.click(editBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Edit Global User Metadata/i })).toBeDefined();
      expect(screen.getByLabelText(/Grant Inhyma ERP Access/i)).toBeDefined();
    });

    // Check Inhyma ERP access grant
    const inhymaCheckbox = screen.getByLabelText(/Grant Inhyma ERP Access/i);
    fireEvent.click(inhymaCheckbox);

    // Save changes
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/users/u-multi/provision", { erp_instance_id: "erp-inhyma" });
    });
  });

  it("displays identity conflict clearly and directs administrator to resolution", async () => {
    const testUser = {
      id: "u-conflict",
      display_name: "Conflicted User",
      primary_email: "conflict@example.com",
      status: "ACTIVE",
    };
    const spokeErps = [
      { id: "erp-yinglima", erp_key: "yinglima-erp", name: "Yinglima ERP", status: "ACTIVE" },
    ];
    const conflicts = [
      {
        id: "conf-1",
        global_user_id: "u-conflict",
        erp_instance_id: "erp-yinglima",
        status: "PENDING_REVIEW",
        conflict_type: "EMAIL_MATCH_DIFFERENT_IDENTITY",
      },
    ];

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users?")) return Promise.resolve([testUser]);
      if (url.includes("/global/erps")) return Promise.resolve(spokeErps);
      if (url.includes("/conflicts")) return Promise.resolve(conflicts);
      if (url.includes("/memberships")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Conflicted User")).toBeDefined();
    });

    // In table, Yinglima Access column displays Conflict badge
    expect(screen.getByText("⚠️ Conflict")).toBeDefined();

    // Open User Detail
    fireEvent.click(screen.getByText("View"));
    await waitFor(() => {
      expect(screen.getByText("Global User: Conflicted User")).toBeDefined();
      expect(screen.getByText("Ecosystem Footprint")).toBeDefined();
    });
  });

  it("supports simple Enable and Disable options for user lifecycle management", async () => {
    const testUser = {
      id: "u-status",
      display_name: "Lifecycle User",
      primary_email: "lifecycle@example.com",
      status: "ACTIVE",
    };

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users?")) return Promise.resolve([testUser]);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      return Promise.resolve([]);
    });

    const patchSpy = vi.spyOn(apiModule, "apiPatch").mockResolvedValue({
      ...testUser,
      status: "DISABLED",
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Lifecycle User")).toBeDefined();
    });

    // Open View
    fireEvent.click(screen.getByText("View"));

    await waitFor(() => {
      expect(screen.getByText("Global User: Lifecycle User")).toBeDefined();
    });

    // Enabled user shows "Disable Account" option in Overview
    expect(screen.getByRole("button", { name: "Disable Account" })).toBeDefined();

    // Click "Disable Account"
    fireEvent.click(screen.getByRole("button", { name: "Disable Account" }));

    await waitFor(() => {
      expect(screen.getByText("Disable User Account?")).toBeDefined();
      expect(screen.getByText(/blocked from logging into the platform and accessing linked ERP accounts/i)).toBeDefined();
    });

    // Confirm disable
    fireEvent.click(screen.getByRole("button", { name: "Disable User" }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith("/global/users/u-status/status", {
        status: "DISABLED",
      });
    });

    // Once disabled, it now shows "Enable Account" option
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Enable Account" })).toBeDefined();
    });

    // Click "Enable Account"
    fireEvent.click(screen.getByRole("button", { name: "Enable Account" }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith("/global/users/u-status/status", {
        status: "ACTIVE",
      });
    });
  });

  it("filters users by ERP assignment including 'None' for unassigned users", async () => {
    const mockUsersWithAccess = [
      {
        id: "u-assigned",
        display_name: "Assigned User",
        primary_email: "assigned@company.com",
        status: "ACTIVE",
        external_identity_id: "EXT-001",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "u-unassigned",
        display_name: "Unassigned User",
        primary_email: "unassigned@company.com",
        status: "ACTIVE",
        external_identity_id: "EXT-002",
        created_at: "2026-01-02T00:00:00Z",
      },
    ];

    const mockMemberships = [
      {
        id: "mem-1",
        global_user_id: "u-assigned",
        erp_instance_id: "erp-1",
        erp_key: "YINGLIMA_TEST",
        status: "ACTIVE",
      },
    ];

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) return Promise.resolve(mockUsersWithAccess);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/global/memberships")) return Promise.resolve(mockMemberships);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Assigned User")).toBeDefined();
      expect(screen.getByText("Unassigned User")).toBeDefined();
    });

    const erpFilterSelect = document.getElementById("select-erp-filter") as HTMLSelectElement;
    expect(erpFilterSelect).toBeDefined();

    // Filter by "None" - should show only unassigned user
    fireEvent.change(erpFilterSelect, { target: { value: "NONE" } });

    expect(screen.queryByText("Assigned User")).toBeNull();
    expect(screen.getByText("Unassigned User")).toBeDefined();

    // Filter by "erp-1" - should show only assigned user
    fireEvent.change(erpFilterSelect, { target: { value: "erp-1" } });

    expect(screen.getByText("Assigned User")).toBeDefined();
    expect(screen.queryByText("Unassigned User")).toBeNull();

    // Reset to "ALL" - should show both
    fireEvent.change(erpFilterSelect, { target: { value: "ALL" } });

    expect(screen.getByText("Assigned User")).toBeDefined();
    expect(screen.getByText("Unassigned User")).toBeDefined();
  });
});



