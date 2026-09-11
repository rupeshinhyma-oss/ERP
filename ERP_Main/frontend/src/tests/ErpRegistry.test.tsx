import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ErpRegistry } from "../pages/ErpRegistry";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("ErpRegistry Component", () => {
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

  it("fetches and renders registered ERP instances", async () => {
    vi.spyOn(apiModule, "apiGet").mockResolvedValueOnce([
      {
        id: "erp-1",
        erp_key: "yinglima",
        name: "Yinglima ERP",
        status: "ACTIVE",
        version: "1.0.0",
        base_url: "http://localhost:8001",
        capabilities: ["buyers", "suppliers", "products"],
        created_at: new Date().toISOString(),
      },
      {
        id: "erp-2",
        erp_key: "inhyma",
        name: "Inhyma ERP",
        status: "ACTIVE",
        version: "1.0.0",
        base_url: "http://localhost:8002",
        capabilities: ["buyers", "orders"],
        created_at: new Date().toISOString(),
      },
    ]);

    render(
      <MemoryRouter>
        <ErpRegistry />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Yinglima ERP")).toBeDefined();
      expect(screen.getByText("Inhyma ERP")).toBeDefined();
    });

    expect(screen.getByText("yinglima")).toBeDefined();
    expect(screen.getByText("inhyma")).toBeDefined();
  });
});
