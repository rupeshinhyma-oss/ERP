import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalUsers } from "../pages/GlobalUsers";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("Global Users list: no Status column", () => {
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

  it("shows identity, email, ERP access, updated and actions, but no Status column or status filter", async () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/users")) {
        return Promise.resolve([
          { id: "u-1", display_name: "Alice Wang", primary_email: "alice@company.com", status: "ACTIVE", external_identity_id: null, created_at: "2026-01-01T00:00:00Z" },
        ]);
      }
      if (url.includes("/global/erps")) {
        return Promise.resolve([{ id: "erp-1", erp_key: "yinglima", name: "Yinglima", status: "ACTIVE", created_at: "2026-01-01T00:00:00Z" }]);
      }
      return Promise.resolve([]);
    });

    const { container } = render(
      <MemoryRouter>
        <GlobalUsers />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Alice Wang")).toBeTruthy());

    const headers = Array.from(container.querySelectorAll("th")).map((th) => (th.textContent || "").trim().toLowerCase());
    expect(headers).not.toContain("status");
    expect(headers).toContain("erp's access");
    expect(headers).toContain("actions");
    expect(container.querySelector("#select-status-filter")).toBeNull();
    expect(screen.queryByText("All Statuses")).toBeNull();
    // access can still be revoked: the Disable action stays
    expect(screen.getAllByRole("button", { name: /disable/i }).length).toBeGreaterThan(0);
  });
});
