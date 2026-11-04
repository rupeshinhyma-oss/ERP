import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TechnicianOperationsPage } from "../TechnicianOperationsPage";
import * as api from "@/lib/api";

const authState = vi.hoisted(() => ({
  isSuperAdmin: true,
  username: "admin",
  perms: [] as string[],
}));

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({
      profile: { username: authState.username },
      isSuperAdmin: authState.isSuperAdmin,
      hasPermission: (code?: string | null) =>
        authState.isSuperAdmin || !code || authState.perms.includes(code),
    }),
  };
});

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    API_ORIGIN: "http://localhost:8000",
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPostMultipart: vi.fn(),
  };
});

function LocationDisplay() {
  const loc = useLocation();
  return <div data-testid="location-display">{`${loc.pathname}${loc.search}`}</div>;
}

const sampleLookups = {
  technicians: [{ id: "tech-1", name: "Ramesh Kumar", mobile: "9876543210", city: "Ahmedabad" }],
  companies: [
    {
      id: "comp-1",
      company_name: "Apex Packaging Ltd",
      city: "Ahmedabad",
      state: "Gujarat",
      address: "Plot 12, GIDC",
      contact_person: "Rajesh Patel",
      contact_phone: "9898011111",
    },
  ],
  warehouses: [{ id: "wh-1", name: "Main Warehouse", is_primary: true }],
  machines: [
    {
      id: "mc-1",
      product_code: "MC-SS5000",
      product_name: "SuperSealer 5000",
      product_type: "Finished Goods",
      uom: "NOS",
      unit_rate: 125000,
    },
  ],
  spare_parts: [
    {
      id: "sp-1",
      product_code: "SP-HEAT-01",
      product_name: "Heating Element 500W",
      product_type: "Spare Parts",
      is_spare_part: true,
      uom: "NOS",
      unit_rate: 1500,
      hsn_code: "85168000",
      gst_percent: 18,
      compatible_machine_ids: ["mc-1"],
      stock_by_warehouse: { "Main Warehouse": 5 },
    },
  ],
  cities: [{ id: "city-1", name: "Ahmedabad", state: "Gujarat" }],
  technical_tasks: [
    {
      id: "task-1",
      task_number: "TT-2026-001",
      company_name: "Apex Packaging Ltd",
      machine_model: "SuperSealer 5000",
      serial_number: "SN-APEX-99",
      task_allotted_to: "Ramesh Kumar",
      task_description: "Heating strip replacement",
    },
  ],
  sale_orders: [
    {
      id: "so-1",
      order_no: "SO-2026-0099",
      company_name: "Apex Packaging Ltd",
      total_amount: 3540,
      status: "confirmed",
    },
  ],
  serial_registry: [
    {
      serial_number: "SN-APEX-99",
      machine_model: "SuperSealer 5000",
      company_name: "Apex Packaging Ltd",
      is_covered: false,
      source: "warranty_registry",
    },
  ],
};

const sampleMetrics = {
  active_gatepasses: 1,
  pending_reconciliations: 0,
  pending_sales_orders: 1,
  total_wallet_cash_held: 4500,
  total_warranties_active: 3,
};

const sampleGatepass = {
  id: "gp-1",
  gatepass_number: "GP-TECH-2026-0001",
  technician_id: "tech-1",
  technician_name: "Ramesh Kumar",
  technician_mobile: "9876543210",
  company_id: "comp-1",
  warehouse_name: "Main Warehouse",
  customer_name: "Apex Packaging Ltd",
  machine_model: "SuperSealer 5000",
  machine_serial_number: "SN-APEX-99",
  is_warranty_service: false,
  issue_date: "2026-11-03",
  issued_by_name: "Admin",
  purpose: "Heating strip replacement",
  status: "PARTIALLY_RETURNED",
  so_required: true,
  so_created: false,
  so_number: null,
  stock_deducted: true,
  return_gatepass_number: "RGP-TECH-2026-0001",
  notes: null,
  created_at: "2026-11-03T10:00:00Z",
  items: [
    {
      id: "gpi-1",
      gatepass_id: "gp-1",
      product_id: "sp-1",
      product_code: "SP-HEAT-01",
      product_name: "Heating Element 500W",
      uom: "NOS",
      quantity_issued: 3,
      quantity_returned: 1,
      quantity_consumed: 2,
      unit_rate: 1500,
      is_warranty_covered: false,
      item_status: "CONSUMED_BILLED",
    },
  ],
  total_issued: 3,
  total_consumed: 2,
  total_returned: 1,
  pending_return: 0,
  reconciliation_message: "Sales Order required for 2 consumed part(s).",
};

describe("TechnicianOperationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn() as any;
    authState.isSuperAdmin = true;
    authState.perms = [];

    vi.mocked(api.apiGet).mockImplementation((url: string) => {
      if (url.includes("/technician-operations/lookups")) {
        return Promise.resolve({ data: sampleLookups } as any);
      }
      if (url.includes("/technician-operations/metrics")) {
        return Promise.resolve({ data: sampleMetrics } as any);
      }
      if (url.includes("/technician-operations/gatepasses/gp-1/draft-so")) {
        return Promise.resolve({
          data: {
            gatepass_id: "gp-1",
            gatepass_number: "GP-TECH-2026-0001",
            customer_name: "Apex Packaging Ltd",
            company_id: "comp-1",
            warehouse_name: "Main Warehouse",
            city: "Ahmedabad",
            state: "Gujarat",
            machine_model: "SuperSealer 5000",
            machine_serial_number: "SN-APEX-99",
            so_created: false,
            items_to_bill: [
              {
                gatepass_item_id: "gpi-1",
                product_id: "sp-1",
                product_code: "SP-HEAT-01",
                product_name: "Heating Element 500W",
                hsn_code: "85168000",
                gst_percent: 18,
                uom: "NOS",
                quantity: 2,
                unit_rate: 1500,
                line_total: 3000,
              },
            ],
            estimated_subtotal: 3000,
            message: "Draft Sales Order generated from Gatepass GP-TECH-2026-0001.",
          },
        } as any);
      }
      if (url.includes("/technician-operations/gatepasses")) {
        return Promise.resolve({
          data: [sampleGatepass],
          meta: { pagination: { total: 1, page: 1, page_size: 25, total_pages: 1 } },
        } as any);
      }
      if (url.includes("/technician-operations/wallet/summaries")) {
        return Promise.resolve({
          data: [
            {
              technician_id: "tech-1",
              technician_name: "Ramesh Kumar",
              technician_mobile: "9876543210",
              total_collected: 4500,
              total_deposited: 0,
              total_expenses: 0,
              net_wallet_balance: 4500,
              status: "PENDING_DEPOSIT",
            },
          ],
        } as any);
      }
      if (url.includes("/technician-operations/wallet/transactions")) {
        return Promise.resolve({
          data: [
            {
              id: "wtx-1",
              transaction_number: "WTX-2026-0001",
              technician_id: "tech-1",
              technician_name: "Ramesh Kumar",
              technical_task_id: "task-1",
              customer_name: "Apex Packaging Ltd",
              transaction_type: "COLLECTION",
              amount: 4500,
              payment_mode: "UPI / QR",
              reference_no: "UTR-9988",
              transaction_date: "2026-11-03",
              receipt_url: "/uploads/technical_tasks/receipt_01.png",
              status: "RECORDED",
              notes: "Collected on field service visit",
              created_at: "2026-11-03T10:00:00Z",
            },
          ],
          meta: { pagination: { total: 1, page: 1, page_size: 25, total_pages: 1 } },
        } as any);
      }
      return Promise.resolve({ data: [] } as any);
    });
    vi.mocked(api.apiPost).mockResolvedValue({ data: {} } as any);
    vi.mocked(api.apiPostMultipart).mockResolvedValue({
      data: { file_url: "/uploads/technical_tasks/voucher.png", file_name: "voucher.png" },
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it("loads master lookups, displays accurate pagination total, and shows warehouse & machine badges with vector SVG icons", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/technician-operations"]}>
        <TechnicianOperationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("GP-TECH-2026-0001")).toBeTruthy();
      expect(screen.getByText("Main Warehouse")).toBeTruthy();
      expect(screen.getByText("SuperSealer 5000")).toBeTruthy();
    });

    // Ensure crisp SVG icons are rendered across header, KPI cards, tabs, and rows
    expect(container.querySelectorAll("svg[aria-hidden='true']").length).toBeGreaterThanOrEqual(8);

    const countSummary = screen.getByText(/Showing/i);
    expect(countSummary.textContent).toContain("Showing 1 of 1 gatepasses");
  });

  it("blocks Outward Gatepass submission when requested catalog part quantity exceeds live warehouse stock", async () => {
    render(
      <MemoryRouter initialEntries={["/technician-operations"]}>
        <TechnicianOperationsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("GP-TECH-2026-0001")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Issue Outward Gatepass/i }));

    const whSelect = (await screen.findByLabelText("Dispatch Warehouse")) as HTMLSelectElement;
    expect(whSelect.value).toBe("Main Warehouse");

    // Select linked technical task to auto-fill technician, customer, machine, serial
    fireEvent.change(screen.getByLabelText("Link Technical Task"), {
      target: { value: "task-1" },
    });

    // Select compatible catalog spare part (Avail: 5)
    fireEvent.change(screen.getByLabelText("Select Catalog Part 1"), {
      target: { value: "sp-1" },
    });
    expect(screen.getByText("Avail: 5 NOS")).toBeTruthy();

    // Request 8 units (> 5 available)
    fireEvent.change(screen.getByLabelText("Qty Issued 1"), {
      target: { value: "8" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create & Issue Gatepass/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Insufficient stock in "Main Warehouse" for "Heating Element 500W": available 5, requested 8/i)
      ).toBeTruthy();
    });
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it("blocks Record Parts Return when Returned + Consumed exceeds Issued quantity", async () => {
    render(
      <MemoryRouter initialEntries={["/technician-operations"]}>
        <TechnicianOperationsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("GP-TECH-2026-0001")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Return$/i }));

    const consumedInput = await screen.findByLabelText("Consumed Qty Heating Element 500W");
    // Issued = 3, Returned = 1; set Consumed = 4 -> total 5 > 3
    fireEvent.change(consumedInput, { target: { value: "4" } });

    const alertBox = await screen.findByRole("alert");
    expect(alertBox.textContent).toContain("cannot exceed Issued (3)");

    const submitBtn = screen.getByRole("button", { name: /Confirm Return & Reconcile/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("navigates to /sales/process/add?gatepass_id=... from Draft SO drawer", async () => {
    render(
      <MemoryRouter initialEntries={["/technician-operations"]}>
        <Routes>
          <Route path="/technician-operations" element={<TechnicianOperationsPage />} />
          <Route path="/sales/process/add" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("GP-TECH-2026-0001")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Draft SO$/i }));

    const createSoBtn = await screen.findByRole("button", {
      name: /Create Sales Order in Sales Process/i,
    });
    fireEvent.click(createSoBtn);

    await waitFor(() => {
      expect(screen.getByTestId("location-display").textContent).toBe(
        "/sales/process/add?gatepass_id=gp-1"
      );
    });
  });

  it("renders wallet receipt attachment link, task sync badge, and uploads voucher in modal", async () => {
    render(
      <MemoryRouter initialEntries={["/technician-operations?tab=wallets"]}>
        <TechnicianOperationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("WTX-2026-0001")).toBeTruthy();
      expect(screen.getByText("Task Sync")).toBeTruthy();
    });

    const receiptLink = screen.getByRole("link", { name: /View Receipt/i }) as HTMLAnchorElement;
    expect(receiptLink.href).toBe("http://localhost:8000/uploads/technical_tasks/receipt_01.png");

    // Open modal and upload receipt voucher
    fireEvent.click(screen.getByRole("button", { name: /Record Wallet Transaction/i }));
    const fileInput = await screen.findByLabelText("Upload Receipt");
    const file = new File(["dummy"], "voucher.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(api.apiPostMultipart).toHaveBeenCalledWith(
        "/technical-tasks/upload-screenshot",
        expect.any(FormData)
      );
      expect(screen.getByText(/Attached: voucher.png/)).toBeTruthy();
    });
  });

  it("enforces read-only RBAC mode when user only has technicaltask.view permission", async () => {
    authState.isSuperAdmin = false;
    authState.perms = ["technicaltask.view"];

    render(
      <MemoryRouter initialEntries={["/technician-operations"]}>
        <TechnicianOperationsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Read-Only Access")).toBeTruthy();
      expect(screen.getByText("GP-TECH-2026-0001")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: /Issue Outward Gatepass/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Return$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Link SO$/i })).toBeNull();
  });
});
