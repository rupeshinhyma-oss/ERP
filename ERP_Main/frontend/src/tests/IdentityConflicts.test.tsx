import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IdentityConflicts } from "../pages/IdentityConflicts";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("IdentityConflicts Component", () => {
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
  });

  it("renders pending identity conflicts in the queue", async () => {
    vi.spyOn(apiModule, "apiGet").mockResolvedValueOnce([
      {
        id: "conflict-1",
        erp_instance_id: "erp-instance-1",
        erp_name: "Yinglima ERP",
        local_user_id: "local-user-99",
        normalized_email: "duplicate@example.com",
        status: "PENDING",
        conflict_type: "AMBIGUOUS_MATCH",
        candidate_global_user_ids: ["candidate-1", "candidate-2"],
        created_at: new Date().toISOString(),
      },
    ]);

    render(
      <MemoryRouter>
        <IdentityConflicts />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("duplicate@example.com")).toBeDefined();
      expect(screen.getByText("local-user-99")).toBeDefined();
      expect(screen.getByText("Ambiguous Match")).toBeDefined();
      expect(screen.getByText("Resolve")).toBeDefined();
    });
  });
});
