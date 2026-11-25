import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsPage } from "../masters/Products";
import * as api from "@/lib/api";
import { friendlyPermissionLabel, MODULE_NAMES } from "@/lib/permissionLabels";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/lib/lookups", () => ({
  useLookup: (url: string) => {
    if (url.includes("sub-categories")) {
      return {
        items: [{ id: "sub-misc", name: "Miscellaneous", category_id: "cat-machines" }],
        loaded: true,
      };
    }
    if (url.includes("categories")) {
      return {
        items: [{ id: "cat-machines", name: "Machines" }],
        loaded: true,
      };
    }
    if (url.includes("brands")) {
      return { items: [{ id: "brand-yinglima", name: "Yinglima" }], loaded: true };
    }
    if (url.includes("uom")) {
      return { items: [{ id: "uom-nos", name: "Numbers", code: "Nos" }], loaded: true };
    }
    return { items: [], loaded: true };
  },
}));

const authState = {
  perms: [] as string[],
};

const stableProfile = { id: "u-1", username: "testuser", display_name: "Test User", full_name: "Test User" };
const stableHasPermission = (code?: string | null) =>
  !code ||
  authState.perms.includes("*") ||
  authState.perms.includes(code) ||
  (code.endsWith(".view") && authState.perms.includes(code.replace(/\.view$/, ".manage")));

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useAuth: () => ({
      hasPermission: stableHasPermission,
      isSuperAdmin: false,
      profile: stableProfile,
    }),
  };
});

const SAMPLE_PRODUCTS = [
  {
    id: "prd-1",
    product_name_tally: "ISL150 Rotary Machine",
    product_name: "ISL150 Rotary Machine",
    product_code: "MACH-150",
    brand_id: "brand-yinglima",
    category_id: "cat-machines",
    sub_category_id: "sub-misc",
    uom_id: "uom-nos",
    standard_price: 250000,
    packaging_quantity: 1,
    packaging_gross_weight: 500,
    packaging_unit_cbm: 2.5,
    status: "active",
  },
];

describe("Product Master granular RBAC permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, "apiGet").mockImplementation(async (url: string) => {
      if (url.includes("/masters/products/machine-spares/universal-view")) {
        return { data: [], success: true } as any;
      }
      if (url.includes("/masters/products")) {
        return { data: SAMPLE_PRODUCTS, success: true } as any;
      }
      return { data: [], success: true } as any;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes friendly permission labels matching Companies RBAC conventions", () => {
    expect(MODULE_NAMES.product).toBe("Product Master");
    expect(friendlyPermissionLabel("product.view")).toBe("View");
    expect(friendlyPermissionLabel("product.manage")).toBe("Manage All");
    expect(friendlyPermissionLabel("product.create")).toBe("+ Add New (Create)");
    expect(friendlyPermissionLabel("product.import")).toBe("Import (Sample + Import)");
    expect(friendlyPermissionLabel("product.export")).toBe("Export");
    expect(friendlyPermissionLabel("product.bulk_action")).toBe("Bulk Actions");
    expect(friendlyPermissionLabel("product.update")).toBe("Action: Edit");
    expect(friendlyPermissionLabel("product.delete")).toBe("Delete (Bulk)");
  });

  it("shows read-only list when only product.view is granted (hides + ADD NEW, Imp / Exp, Bulk Actions, checkboxes, Action column & Edit)", async () => {
    authState.perms = ["product.view", "company.manage"];

    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("ISL150 Rotary Machine")).toBeTruthy());

    expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Imp \/ Exp|Import|Export/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bulk Actions/i })).toBeNull();
    expect(screen.queryByTitle("Edit Product")).toBeNull();
    expect(screen.queryByText("Action")).toBeNull();
    expect(screen.queryAllByRole("checkbox").length).toBe(0);

    // Opening detail drawer in view-only mode hides "Edit Product" header button
    fireEvent.click(screen.getByText("ISL150 Rotary Machine"));
    await waitFor(() => expect(screen.getByText("Identity & Classification")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Edit Product/i })).toBeNull();
  });

  it("prevents defaultAdd from opening Add Product form without product.create or product.manage", async () => {
    authState.perms = ["product.view"];

    render(
      <MemoryRouter>
        <ProductsPage defaultAdd={true} />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "Product Master" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Add Product" })).toBeNull();
  });

  it("controls + ADD NEW independently with product.create", async () => {
    authState.perms = ["product.view", "product.create"];

    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("ISL150 Rotary Machine")).toBeTruthy());

    const addBtn = screen.getByRole("button", { name: /\+ ADD NEW/i });
    expect(addBtn).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Imp \/ Exp|Import|Export/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bulk Actions/i })).toBeNull();
    expect(screen.queryByTitle("Edit Product")).toBeNull();

    fireEvent.click(addBtn);
    expect(screen.getByRole("heading", { name: "Add Product" })).toBeTruthy();
  });

  it("controls Import (Sample + Import) and Export independently and combines them into Imp / Exp", async () => {
    authState.perms = ["product.view", "product.import"];
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("ISL150 Rotary Machine")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Import$/i }));
    expect(screen.getByRole("menuitem", { name: "SAMPLE FILE" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "IMPORT" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "EXPORT" })).toBeNull();

    cleanup();
    authState.perms = ["product.view", "product.export"];
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("ISL150 Rotary Machine")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Export$/i }));
    expect(screen.queryByRole("menuitem", { name: "SAMPLE FILE" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "IMPORT" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "EXPORT" })).toBeTruthy();

    cleanup();
    authState.perms = ["product.view", "product.import", "product.export"];
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("ISL150 Rotary Machine")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Imp \/ Exp/i }));
    expect(screen.getByRole("menuitem", { name: "SAMPLE FILE" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "IMPORT" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "EXPORT" })).toBeTruthy();
  });

  it("controls Bulk Actions, Action: Edit, and Manage All cleanly", async () => {
    // product.update alone shows Action: Edit, NOT Bulk Actions or + ADD NEW
    authState.perms = ["product.view", "product.update"];
    const { rerender } = render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("ISL150 Rotary Machine")).toBeTruthy());
    expect(screen.getByText("Action")).toBeTruthy();
    expect(screen.getAllByTitle("Edit Product").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Bulk Actions/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /\+ ADD NEW/i })).toBeNull();

    // product.bulk_action without product.update or product.delete hides Action column and Bulk Delete
    authState.perms = ["product.view", "product.bulk_action"];
    rerender(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );
    expect(screen.queryByText("Action")).toBeNull();
    expect(screen.queryByTitle("Edit Product")).toBeNull();
    expect(screen.getByRole("button", { name: /Bulk Actions/i })).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(1);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /Bulk Actions/i }));
    expect(screen.getByText(/Bulk Activate/i)).toBeTruthy();
    expect(screen.getByText(/Bulk Inactive/i)).toBeTruthy();
    expect(screen.queryByText(/Bulk Delete/i)).toBeNull();
    // Close menu before switching permissions so the next click opens it cleanly
    fireEvent.click(screen.getByRole("button", { name: /Bulk Actions/i }));

    // product.manage grants everything
    authState.perms = ["product.manage"];
    rerender(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /\+ ADD NEW/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Imp \/ Exp/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bulk Actions/i })).toBeTruthy();
    expect(screen.getAllByTitle("Edit Product").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Bulk Actions/i }));
    expect(screen.getByText(/Bulk Delete/i)).toBeTruthy();
  });
});
