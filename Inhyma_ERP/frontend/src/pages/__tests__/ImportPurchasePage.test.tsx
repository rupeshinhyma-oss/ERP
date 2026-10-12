import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportPurchasePage } from "../purchase/ImportPurchasePage";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostMultipart, apiPut } from "@/lib/api";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

// The signed-in user is controlled per test
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
vi.mock("@/lib/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks")>()),
  useAuth: () => ({
    profile: { username: "marketing", full_name: "Marketing User" },
    isSuperAdmin: auth.isSuperAdmin,
    hasPermission: () => false,
  }),
}));

// Real helpers stay (toQueryString, errorMessage); only the network functions are faked
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  apiPostMultipart: vi.fn(),
}));

// ---- fake backend ----
const RULES = {
  pending: { label: "Pending", card_label: "PENDING", next: ["confirmed"], edit: "any", delete: "any", initial: true, stock_in: true },
  confirmed: { label: "Confirmed", card_label: "CONFIRMED", next: ["received"], edit: "admin", delete: "admin", action_label: "Confirm" },
  received: { label: "Received", card_label: "RECEIVED", next: ["closed"], admin_only_to: ["closed"], edit: "any", delete: "none", action_label: "Receive" },
  closed: { label: "Closed", card_label: "CLOSED", next: [], edit: "none", delete: "none", action_label: "Close" },
};

const ITEM = {
  id: "i1", product_name: "ISL350XDAN Flow Wrap Machine", product_code: "P1", uom: "Nos", quantity: 10, pkg_unit_cbm: 0.5, pkg_qty: 1,
  item_total_cbm: 5, unit_rate_usd: 60, unit_rate_inr: 4800, item_total_usd: 600, duty_percent: 10, unit_import_duty: 492,
  item_total_duty: 4920, exp_per_unit_vb: 600, exp_per_unit_cb: 250, unit_landing_vb: 5892, unit_landing_cb: 5542, landing_diff: -350,
};
const base = {
  supplier_id: "s1", supplier_name: "Yinglima", ordered_date: "01-09-2026", etd_origin_date: "10-10-2026", eta_port_date: "25-10-2026",
  expected_arrival_date: "30-10-2026", invoice_date: null, conversion_rate: 80, customs_conversion_rate: 82, invoice_total_usd: 1000,
  invoice_total_inr: 80000, total_cbm: 20, total_import_duty: 6000, freight: 4000, insurance: 400, stamp_duty: 100, shipping_line_charges: 1000,
  cfs_charges: 1500, clearing_transport: 2000, offloading: 500, misc_charges: 500, misc_remarks: null, total_expenses: 10000,
  gross_total_landing: 96000, loading_percent_vb: 12.5, loading_amount_per_cbm: 500, remarks: null, bill_file_name: null, bill_file_url: null,
  stock_applied: true, created_by: "marketing", created_date: "05-10-2026", updated_date: "06-10-2026", sum_cbm: 5, sum_usd: 600, sum_duty: 4920,
  supplier_address: "No. 18, Industrial Zone, Ningbo", supplier_email: "export@supplier.test", supplier_phone: "+86 574 0000", supplier_gst: "TAX-YIN-1",
  to_name: "Inhyma Solutions LLP (M)", to_address: "4th Floor, Wagle Estate, Thane, 400604", to_email: "accounts@inhyma.test",
  to_phone: "9000000001", to_gst: "27AAKFI9869H1ZL", items: [ITEM],
};
const INITIAL = [
  { ...base, id: "ip-1", consignment_no: "MUM51", warehouse: "Mumbai Ordered", status: "pending" },
  { ...base, id: "ip-2", consignment_no: "MUM52", warehouse: "Mumbai", status: "confirmed" },
  { ...base, id: "ip-3", consignment_no: "MUM53", warehouse: "Mumbai Ordered", status: "received" },
];
let server: any[] = [];

const PREVIEW = {
  invoice_total_inr: 80000, total_expenses: 10000, gross_total_landing: 96000, loading_percent_vb: 12.5, loading_amount_per_cbm: 500,
  sum_cbm: 5, sum_usd: 600, sum_duty: 4920, items: [ITEM],
};

function fakeApiGet(url: string): Promise<any> {
  if (url.startsWith("/purchase/import-orders?")) {
    const counts: any = { all: { count: server.length } };
    for (const k of Object.keys(RULES)) counts[k] = { count: server.filter((o) => o.status === k).length };
    return Promise.resolve({ data: { items: server, tab_counts: counts, status_rules: RULES }, meta: { total: server.length } });
  }
  const one = url.match(/^\/purchase\/import-orders\/([^/?]+)$/);
  if (one) return Promise.resolve({ data: server.find((o) => o.id === one[1]) });
  if (url.startsWith("/masters/options/lookup")) {
    return Promise.resolve({ data: { "purchase.import.defaults": [
      { id: "1", value: "supplier", label: "Yinglima", sort_order: 1 }, { id: "2", value: "warehouse", label: "Mumbai Ordered", sort_order: 2 }] } });
  }
  if (url.startsWith("/suppliers")) return Promise.resolve({ data: [{ id: "s1", company_name: "Yinglima" }, { id: "s2", company_name: "Darsh Impex India LLP Mumbai" }] });
  if (url.startsWith("/masters/warehouses")) {
    return Promise.resolve({ data: [{ name: "Mumbai", main_warehouse_id: null }, { name: "Mumbai Ordered", main_warehouse_id: "w1" },
      { name: "Mumbai Transit", main_warehouse_id: "w1" }] });
  }
  if (url.startsWith("/masters/products")) return Promise.resolve({ data: [{ product_name: "ISL350XDAN Flow Wrap Machine" }] });
  return Promise.resolve({ data: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.isSuperAdmin = false;
  server = JSON.parse(JSON.stringify(INITIAL));
  (apiGet as any).mockImplementation(fakeApiGet);
  (apiPost as any).mockImplementation(async (url: string, body: any) => {
    if (url.endsWith("/preview")) return { data: PREVIEW };
    const created = { ...base, ...body, id: "ip-new", status: "pending", items: body.items.map((i: any) => ({ ...ITEM, product_name: i.product_name, quantity: i.quantity })) };
    server.unshift(created);
    return { data: created };
  });
  (apiPut as any).mockImplementation(async (url: string, body: any) => ({ data: { id: url.split("/").pop(), ...body } }));
  (apiPatch as any).mockImplementation(async (url: string, body: any) => {
    const o = server.find((x) => x.id === url.split("/")[3]);
    if (o) o.status = body.status;
    return { data: o };
  });
  (apiDelete as any).mockImplementation(async (url: string) => {
    server = server.filter((o) => o.id !== url.split("/").pop());
    return { data: { deleted: true } };
  });
  (apiPostMultipart as any).mockResolvedValue({ data: {} });
});

afterEach(() => cleanup());

const renderImportPage = (initialRoute = "/purchase-order/import-purchase-list") =>
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/purchase/importpurchase" element={<ImportPurchasePage defaultAdd={false} />} />
        <Route path="/purchase/importpurchase/addedit" element={<ImportPurchasePage defaultAdd={true} />} />
        <Route path="/purchase-order/import-purchase-list" element={<ImportPurchasePage defaultAdd={false} />} />
        <Route path="/purchase-order/import-purchase/addedit" element={<ImportPurchasePage defaultAdd={true} />} />
        <Route path="/purchase-order/import-purchase/addedit/:id" element={<ImportPurchasePage defaultAdd={true} />} />
        <Route path="/purchase/import" element={<ImportPurchasePage defaultAdd={false} />} />
      </Routes>
    </MemoryRouter>
  );
const loaded = async () => {
  renderImportPage();
  await screen.findByText("MUM51");
};
const today = new Date();
const dd = (n: number) => String(n).padStart(2, "0");
const TODAY = `${dd(today.getDate())}-${dd(today.getMonth() + 1)}-${today.getFullYear()}`;
const calls = (fn: any, prefix: string) => fn.mock.calls.filter((c: any[]) => String(c[0]).startsWith(prefix));

describe("ImportPurchasePage list (data comes from the API)", () => {
  it("renders the page title and the action buttons", () => {
    renderImportPage();
    expect(screen.getByRole("heading", { name: "Import Purchase" })).toBeTruthy();
    expect(screen.getByTestId("btn-filter-toggle")).toBeTruthy();
    expect(screen.getByTestId("btn-add-new")).toBeTruthy();
    expect(screen.getByTestId("btn-export")).toBeTruthy();
  });

  it("builds one KPI card and one tab per status in the DB-configured workflow, with counts", async () => {
    await loaded();
    for (const key of ["all", "pending", "confirmed", "received", "closed"]) expect(screen.getByTestId(`kpi-card-${key}`)).toBeTruthy();
    expect(screen.getByTestId("kpi-card-pending").textContent).toContain("(1)");
    expect(screen.getByTestId("kpi-card-all").textContent).toContain("(3)");
    expect(screen.getByTestId("kpi-card-closed").textContent).toContain("(0)");
    expect(screen.getByTestId("tab-pending").textContent).toBe("Pending (1)");

    fireEvent.click(screen.getByTestId("tab-confirmed"));
    expect(screen.getByText("MUM52")).toBeTruthy();
    expect(screen.queryByText("MUM51")).toBeNull();
    fireEvent.click(screen.getByTestId("tab-all"));
    expect(screen.getByText("MUM51")).toBeTruthy();
  });

  it("renders the table header columns", () => {
    renderImportPage();
    for (const name of [/^Inv. \/ Con. No & Date/i, /^Supplier/i, /^Warehouse/i, /^Ordered Date/i, "ETD Origin Date", "ETA Port Date", "Arrival Date",
      "Inv. Total ($)", "Inv. Total (₹)", "Total CBM", "Total Exp", "% Loading Exp(VB)", "Loading Exp(CB)(₹)", "Gross Total Landing(₹)", "Created By",
      "Invoice", /^Updated Date/i, /^Status/i, "Action"]) {
      expect(screen.getByRole("columnheader", { name })).toBeTruthy();
    }
  });

  it("shows the consignments the API returned, with status labels from the rules", async () => {
    await loaded();
    expect(screen.getByText("MUM52")).toBeTruthy();
    expect(screen.getByText("MUM53")).toBeTruthy();
    expect(screen.getAllByText("Yinglima").length).toBeGreaterThan(0);
    for (const label of ["Pending", "Confirmed", "Received"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(localStorage.getItem("inhyma_import_purchase_orders")).toBeNull();
  });

  it("shows the server's message if the list cannot be loaded (no invented consignments)", async () => {
    (apiGet as any).mockImplementation((url: string) =>
      url.startsWith("/purchase/import-orders?") ? Promise.reject(new Error("Database is down")) : fakeApiGet(url)
    );
    renderImportPage();
    expect(await screen.findByText(/Database is down/)).toBeTruthy();
    expect(screen.queryByText("MUM51")).toBeNull();
  });

  it("filters consignments using the search input", async () => {
    await loaded();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "MUM52" } });
    expect(screen.getByText("MUM52")).toBeTruthy();
    expect(screen.queryByText("MUM51")).toBeNull();
  });

  it("toggles the filter panel", async () => {
    await loaded();
    expect(screen.queryByTestId("filter-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("btn-filter-toggle"));
    const panel = screen.getByTestId("filter-panel");
    expect(within(panel).getByText("Warehouse")).toBeTruthy();
    expect(within(panel).getByText("Supplier")).toBeTruthy();
  });

  it("opens the details modal with the real party details from the masters, and closes on Escape", async () => {
    await loaded();
    fireEvent.click(screen.getByText("MUM51"));
    const modal = screen.getByTestId("import-purchase-details-modal");
    const scope = within(modal);
    for (const t of ["Import Purchase Details", "Order Detail", "From", "To", "Expenses", "Product Summary"]) expect(scope.getByText(t)).toBeTruthy();
    expect(scope.getByText("ISL350XDAN Flow Wrap Machine")).toBeTruthy();
    const text = modal.textContent || "";
    for (const real of ["TAX-YIN-1", "export@supplier.test", "27AAKFI9869H1ZL", "Inhyma Solutions LLP (M)", "accounts@inhyma.test"]) expect(text).toContain(real);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("import-purchase-details-modal")).toBeNull();
  });

  it("never fills in party details or line items the masters did not provide", async () => {
    server[0] = { ...server[0], supplier_gst: "", supplier_email: "", to_gst: "", to_email: "", to_address: "", items: [] };
    await loaded();
    fireEvent.click(screen.getByText("MUM51"));
    const text = screen.getByTestId("import-purchase-details-modal").textContent || "";
    for (const invented of ["07ABCDE1234F1Z5", "27AAKFI9869H1ZL", "Payment.Darsh", "Supremus", "9654123654", "Multi Head Weigher", "ISL350XDAN"]) {
      expect(text).not.toContain(invented);
    }
  });

  it("triggers a file download when clicking Export", async () => {
    const createElementSpy = vi.spyOn(document, "createElement");
    await loaded();
    fireEvent.click(screen.getByTestId("btn-export"));
    expect(createElementSpy).toHaveBeenCalledWith("a");
    createElementSpy.mockRestore();
  });
});

describe("ImportPurchasePage row actions follow the database rules and the user's role", () => {
  const open = async (id: string) => {
    await loaded();
    fireEvent.click(screen.getByTestId(`btn-action-${id}`));
  };

  it("pending: Edit, Confirm and Delete are open to everyone", async () => {
    await open("ip-1");
    for (const a of ["edit", "confirm", "delete"]) expect(screen.getByTestId(`action-${a}-ip-1`)).toBeTruthy();
    expect(screen.queryByTestId("action-download-ip-1")).toBeNull();
  });

  it("confirmed: a normal user can only move it to Received and download; Edit and Delete are admin-only", async () => {
    await open("ip-2");
    expect(screen.getByTestId("action-confirm-ip-2").textContent).toContain("Receive");
    expect(screen.getByTestId("action-download-ip-2")).toBeTruthy();
    for (const a of ["edit", "delete", "delete-confirmed"]) expect(screen.queryByTestId(`action-${a}-ip-2`)).toBeNull();
  });

  it("confirmed: an administrator also gets Edit and Delete", async () => {
    auth.isSuperAdmin = true;
    await open("ip-2");
    expect(screen.getByTestId("action-edit-ip-2")).toBeTruthy();
    expect(screen.getByTestId("action-delete-confirmed-ip-2")).toBeTruthy();
  });

  it("received: Close is admin-only, and nobody can delete it", async () => {
    await open("ip-3");
    expect(screen.queryByTestId("action-confirm-ip-3")).toBeNull();             // closing is an admin step
    expect(screen.getByTestId("action-edit-ip-3")).toBeTruthy();
    expect(screen.queryByTestId("action-delete-confirmed-ip-3")).toBeNull();
    cleanup();
    auth.isSuperAdmin = true;
    await open("ip-3");
    expect(screen.getByTestId("action-confirm-ip-3").textContent).toContain("Close");
    expect(screen.queryByTestId("action-delete-confirmed-ip-3")).toBeNull();    // delete is 'none' even for an admin
  });

  it("Confirm is saved through the status API and the list is reloaded", async () => {
    await open("ip-1");
    fireEvent.click(screen.getByTestId("action-confirm-ip-1"));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("/purchase/import-orders/ip-1/status", { status: "confirmed", reason: undefined }));
    await waitFor(() => expect(screen.getByTestId("tab-pending").textContent).toBe("Pending (0)"));
  });

  it("Delete asks for confirmation and calls the delete API", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await open("ip-1");
    fireEvent.click(screen.getByTestId("action-delete-ip-1"));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/purchase/import-orders/ip-1"));
    await waitFor(() => expect(screen.queryByText("MUM51")).toBeNull());
    confirmSpy.mockRestore();
  });

  it("downloads by the consignment id", async () => {
    const originalOpen = window.open;
    window.open = vi.fn();
    await open("ip-2");
    fireEvent.click(screen.getByTestId("action-download-ip-2"));
    expect(window.open).toHaveBeenCalledWith("/purchase-order/import-bill-file/ip-2", "_blank");
    window.open = originalOpen;
  });
});

describe("ImportPurchasePage Add / Edit form (Import Purchase spec)", () => {
  const openAdd = async () => {
    renderImportPage("/purchase-order/import-purchase/addedit");
    await screen.findByDisplayValue("Mumbai Ordered");
  };
  const fill = async () => {
    fireEvent.change(screen.getByLabelText("Invoice / Consignment No."), { target: { value: "EXP-86" } });
    fireEvent.change(screen.getByLabelText("Conversion Rate (USD to INR)"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Customs Conversion Rate (USD to INR)"), { target: { value: "82" } });
    fireEvent.change(screen.getByLabelText("Invoice Total Value (USD)"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("Freight"), { target: { value: "4000" } });
    fireEvent.change(screen.getByLabelText("Product Search"), { target: { value: "ISL" } });
    fireEvent.click(await screen.findByRole("option", { name: "ISL350XDAN Flow Wrap Machine" }));
    fireEvent.change(screen.getByLabelText("Quantity 1"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Unit Rate USD 1"), { target: { value: "60" } });
  };

  it("starts with the DB-configured supplier and warehouse and no built-in numbers", async () => {
    await openAdd();
    expect((screen.getByLabelText("Supplier") as HTMLSelectElement).value).toBe("Yinglima");
    expect((screen.getByLabelText("Warehouse") as HTMLSelectElement).value).toBe("Mumbai Ordered");
    expect((screen.getByLabelText("Ordered Date") as HTMLInputElement).value).toBe(TODAY);
    // these used to be pre-filled with 83.50, 65.0, 250000, 380000, 65000 and a made-up remark
    for (const label of ["Conversion Rate (USD to INR)", "Customs Conversion Rate (USD to INR)", "Total CBM", "Freight", "Offloading", "Total Import Duty (INR)"]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    }
    expect((screen.getByLabelText("Remarks") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByLabelText("Insurance")).toBeTruthy();
  });

  it("has the spec's eight expense lines, both conversion rates and the costing columns", async () => {
    await openAdd();
    for (const label of ["Freight", "Insurance", "Stamp Duty", "Shipping Line Charges", "CFS Charges", "Clearing & Transport", "Offloading", "Miscellaneous",
      "Total Expenses", "Invoice Total Value (INR)", "Gross Total Landing (INR)", "% Loading Expense (Value Based)", "Loading Amount per CBM",
      "ETD Origin Date", "ETA Port Date", "Expected Arrival Date", "Total CBM", "Total Import Duty (INR)"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    for (const col of ["Pkg Unit CBM", "Pkg Qty", "Total CBM", "Unit Rate (USD)", "Import Duty %", "Unit Import Duty (INR)", "Exp / Unit (VB)",
      "Exp / Unit (CB)", "Unit Landing (VB)", "Unit Landing (CB)", "Diff (CB - VB)"]) {
      expect(screen.getByRole("columnheader", { name: col })).toBeTruthy();
    }
  });

  it("shows the landing cost calculated by the server while you type", async () => {
    await openAdd();
    await fill();
    await waitFor(() => expect((screen.getByLabelText("Invoice Total Value (INR)") as HTMLInputElement).value).toBe("₹ 80,000.00"));
    expect((screen.getByLabelText("Total Expenses") as HTMLInputElement).value).toBe("₹ 10,000.00");
    expect((screen.getByLabelText("Gross Total Landing (INR)") as HTMLInputElement).value).toBe("₹ 96,000.00");
    expect((screen.getByLabelText("% Loading Expense (Value Based)") as HTMLInputElement).value).toBe("12.5%");
    const row = screen.getByLabelText("Quantity 1").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("5,892.00");                                  // unit landing (VB)
    expect(row.textContent).toContain("5,542.00");                                  // unit landing (CB)
    expect(screen.getByTestId("sum-cbm").textContent).toBe("5");
    const previewCall = calls(apiPost, "/purchase/import-orders/preview").pop();
    expect(previewCall[1]).toMatchObject({ conversion_rate: 80, customs_conversion_rate: 82, freight: 4000 });
    expect(previewCall[1].items).toEqual([{ product_name: "ISL350XDAN Flow Wrap Machine", quantity: 10, unit_rate_usd: 60 }]);
  });

  it("shows the server's reason if the live calculation fails", async () => {
    await openAdd();
    (apiPost as any).mockImplementation(async (url: string) => {
      if (url.endsWith("/preview")) throw new Error("Product 'X' is not in the Product Master.");
      return { data: {} };
    });
    fireEvent.change(screen.getByLabelText("Freight"), { target: { value: "100" } });
    expect(await screen.findByText(/not in the Product Master/)).toBeTruthy();
  });

  it("validates the required fields before calling the API", async () => {
    await openAdd();
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Consignment" }));
    for (const t of [/Supplier is required/, /Consignment No\. is required/, /Conversion rate is required/, /Customs conversion rate is required/, /at least one product/i]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(calls(apiPost, "/purchase/import-orders").filter((c: any[]) => !String(c[0]).endsWith("/preview")).length).toBe(0);
  });

  it("creates the consignment through the API, sending only what was entered", async () => {
    await openAdd();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Submit Consignment" }));
    await waitFor(() => expect(calls(apiPost, "/purchase/import-orders").some((c: any[]) => c[0] === "/purchase/import-orders")).toBe(true));
    const [, body] = calls(apiPost, "/purchase/import-orders").find((c: any[]) => c[0] === "/purchase/import-orders");
    expect(body).toMatchObject({ consignment_no: "EXP-86", supplier_name: "Yinglima", warehouse: "Mumbai Ordered", conversion_rate: 80, customs_conversion_rate: 82, freight: 4000 });
    expect(body.items).toEqual([{ product_name: "ISL350XDAN Flow Wrap Machine", quantity: 10, unit_rate_usd: 60 }]);
    for (const k of ["status", "created_by", "invoice_total_inr", "total_expenses", "gross_total_landing", "loading_percent_vb"]) expect(body).not.toHaveProperty(k);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Import Purchase" })).toBeTruthy());
    expect(await screen.findByText("EXP-86")).toBeTruthy();
    expect(localStorage.getItem("inhyma_import_purchase_orders")).toBeNull();
  });

  it("stays on the form and shows the server's reason when saving fails", async () => {
    await openAdd();
    await fill();
    (apiPost as any).mockImplementation(async (url: string) => {
      if (url.endsWith("/preview")) return { data: PREVIEW };
      throw new Error("Consignment 'EXP-86' is already recorded.");
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Consignment" }));
    expect(await screen.findByText(/already recorded/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add Import Purchase" })).toBeTruthy();
    expect(server.some((o) => o.consignment_no === "EXP-86")).toBe(false);
  });

  it("uploads the chosen invoice after saving", async () => {
    const { container } = renderImportPage("/purchase-order/import-purchase/addedit");
    await screen.findByDisplayValue("Mumbai Ordered");
    await fill();
    const file = new File(["pdf"], "invoice.pdf", { type: "application/pdf" });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    expect(screen.getByText("invoice.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit Consignment" }));
    await waitFor(() => expect(apiPostMultipart).toHaveBeenCalledTimes(1));
    expect((apiPostMultipart as any).mock.calls[0][0]).toBe("/purchase/import-orders/ip-new/bill");
  });

  it("Edit opens the saved consignment and saves with PUT", async () => {
    await loaded();
    fireEvent.click(screen.getByTestId("btn-action-ip-1"));
    fireEvent.click(screen.getByTestId("action-edit-ip-1"));
    expect(screen.getByRole("heading", { name: "Edit Import Purchase" })).toBeTruthy();
    expect((screen.getByLabelText("Invoice / Consignment No.") as HTMLInputElement).value).toBe("MUM51");
    expect((screen.getByLabelText("Conversion Rate (USD to INR)") as HTMLInputElement).value).toBe("80");
    expect((screen.getByLabelText("Freight") as HTMLInputElement).value).toBe("4000");
    expect(screen.getByText("ISL350XDAN Flow Wrap Machine")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update Consignment" }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect((apiPut as any).mock.calls[0][0]).toBe("/purchase/import-orders/ip-1");
  });

  it("locks the warehouse once stock has gone into a physical warehouse, but not for an ordered warehouse", async () => {
    auth.isSuperAdmin = true;
    await loaded();
    fireEvent.click(screen.getByTestId("btn-action-ip-2"));                       // received into physical 'Mumbai'
    fireEvent.click(screen.getByTestId("action-edit-ip-2"));
    expect((screen.getByLabelText("Warehouse") as HTMLSelectElement).disabled).toBe(true);
    cleanup();
    await loaded();
    fireEvent.click(screen.getByTestId("btn-action-ip-1"));                       // 'Mumbai Ordered' is not physical
    fireEvent.click(screen.getByTestId("action-edit-ip-1"));
    expect((screen.getByLabelText("Warehouse") as HTMLSelectElement).disabled).toBe(false);
  });

  it("opening .../addedit/:id loads that consignment from the API", async () => {
    renderImportPage("/purchase-order/import-purchase/addedit/ip-3");
    await waitFor(() => expect((screen.getByLabelText("Invoice / Consignment No.") as HTMLInputElement).value).toBe("MUM53"));
  });
});

// ----------------------------------------------------------------------------------------------
// Import Purchase spec: gaps found in the ERP_4 review
// ----------------------------------------------------------------------------------------------
const dmy = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${dd(d.getDate())}-${dd(d.getMonth() + 1)}-${d.getFullYear()}`;
};

describe("ImportPurchasePage: Invoice Date, item duty column and details (spec)", () => {
  it("has an Invoice Date field, sent to the API when filled", async () => {
    renderImportPage("/purchase-order/import-purchase/addedit");
    await screen.findByDisplayValue("Mumbai Ordered");
    expect((screen.getByLabelText("Invoice Date") as HTMLInputElement).value).toBe("");   // optional, blank by default
    fireEvent.change(screen.getByLabelText("Invoice / Consignment No."), { target: { value: "EXP-90" } });
    fireEvent.change(screen.getByLabelText("Invoice Date"), { target: { value: "15-09-2026" } });
    fireEvent.change(screen.getByLabelText("Conversion Rate (USD to INR)"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Customs Conversion Rate (USD to INR)"), { target: { value: "82" } });
    fireEvent.change(screen.getByLabelText("Product Search"), { target: { value: "ISL" } });
    fireEvent.click(await screen.findByRole("option", { name: "ISL350XDAN Flow Wrap Machine" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Consignment" }));
    await waitFor(() => expect(calls(apiPost, "/purchase/import-orders").some((c: any[]) => c[0] === "/purchase/import-orders")).toBe(true));
    const [, body] = calls(apiPost, "/purchase/import-orders").find((c: any[]) => c[0] === "/purchase/import-orders");
    expect(body.invoice_date).toBe("15-09-2026");
  });

  it("shows the invoice date under the consignment number in the list, and on edit", async () => {
    server[0].invoice_date = "15-09-2026";
    await loaded();
    const row = screen.getByText("MUM51").closest("tr") as HTMLElement;
    expect(within(row).getByText("15-09-2026")).toBeTruthy();
    fireEvent.click(screen.getByTestId("btn-action-ip-1"));
    fireEvent.click(screen.getByTestId("action-edit-ip-1"));
    expect((screen.getByLabelText("Invoice Date") as HTMLInputElement).value).toBe("15-09-2026");
  });

  it("has the per-row Item Total Import Duty column and the duty total under it", async () => {
    renderImportPage("/purchase-order/import-purchase/addedit");
    await screen.findByDisplayValue("Mumbai Ordered");
    expect(screen.getByRole("columnheader", { name: "Item Total Import Duty (INR)" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Product Search"), { target: { value: "ISL" } });
    fireEvent.click(await screen.findByRole("option", { name: "ISL350XDAN Flow Wrap Machine" }));
    fireEvent.change(screen.getByLabelText("Unit Rate USD 1"), { target: { value: "60" } });
    const row = await waitFor(() => {
      const r = screen.getByLabelText("Quantity 1").closest("tr") as HTMLElement;
      expect(r.textContent).toContain("4,920.00");                                   // item total duty (O x Y), from the server
      return r;
    });
    const cells = Array.from(row.querySelectorAll("td")).map((c) => c.textContent);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(cells[headers.indexOf("Item Total Import Duty (INR)")]).toContain("4,920.00");
    const tfootCells = Array.from(screen.getByTestId("sum-duty").closest("tr")!.querySelectorAll("td"));
    const dutyTotalColumn = tfootCells.slice(0, tfootCells.indexOf(screen.getByTestId("sum-duty") as HTMLTableCellElement)).reduce((n, c) => n + Number(c.getAttribute("colspan") || 1), 0);
    expect(dutyTotalColumn).toBe(headers.indexOf("Item Total Import Duty (INR)"));  // the total sits under its own column
  });

  it("the details view shows the ordered date, the supplier address and the miscellaneous remarks", async () => {
    server[0].misc_remarks = "Detention charges for 2 days";
    await loaded();
    fireEvent.click(screen.getByText("MUM51"));
    const text = screen.getByTestId("import-purchase-details-modal").textContent || "";
    expect(text).toContain("Ordered Date: 01-09-2026");
    expect(text).toContain("No. 18, Industrial Zone, Ningbo");
    expect(text).toContain("Detention charges for 2 days");
  });
});

describe("ImportPurchasePage: date-range and master-driven filters (spec)", () => {
  const openFilters = async () => {
    server[0].exp_arri = undefined;
    await loaded();
    fireEvent.click(screen.getByTestId("btn-filter-toggle"));
    return screen.getByTestId("filter-panel");
  };
  const arrivals = (a: string, b: string, c: string) => {
    server[0].expected_arrival_date = a;
    server[1].expected_arrival_date = b;
    server[2].expected_arrival_date = c;
  };

  it("offers Expected Arrival, ETD Origin and ETA Port ranges with the spec's presets", async () => {
    const panel = await openFilters();
    for (const label of ["Expected Arrival Date Range", "ETD Origin Date Range", "ETA Port Date Range"]) {
      const select = within(panel).getByLabelText(label) as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
        ["All dates", "Today", "Last 7 days", "Next 7 days", "This Month", "Next Month", "Custom Range"]
      );
    }
  });

  it("filters by the Expected Arrival range, then clears with Reset", async () => {
    arrivals(dmy(2), dmy(40), dmy(-3));
    const panel = await openFilters();
    fireEvent.change(within(panel).getByLabelText("Expected Arrival Date Range"), { target: { value: "next7" } });
    expect(screen.getByText("MUM51")).toBeTruthy();
    expect(screen.queryByText("MUM52")).toBeNull();
    expect(screen.queryByText("MUM53")).toBeNull();

    fireEvent.change(within(panel).getByLabelText("Expected Arrival Date Range"), { target: { value: "last7" } });
    expect(screen.getByText("MUM53")).toBeTruthy();
    expect(screen.queryByText("MUM51")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Reset" }));
    for (const n of ["MUM51", "MUM52", "MUM53"]) expect(screen.getByText(n)).toBeTruthy();
  });

  it("supports a custom range (and shows From / To pickers only then)", async () => {
    arrivals("05-10-2026", "20-10-2026", "30-10-2026");
    const panel = await openFilters();
    expect(within(panel).queryByLabelText("Expected Arrival Date Range From")).toBeNull();
    fireEvent.change(within(panel).getByLabelText("Expected Arrival Date Range"), { target: { value: "custom" } });
    fireEvent.change(within(panel).getByLabelText("Expected Arrival Date Range From"), { target: { value: "15-10-2026" } });
    fireEvent.change(within(panel).getByLabelText("Expected Arrival Date Range To"), { target: { value: "25-10-2026" } });
    expect(screen.getByText("MUM52")).toBeTruthy();
    expect(screen.queryByText("MUM51")).toBeNull();
    expect(screen.queryByText("MUM53")).toBeNull();
  });

  it("filters by ETD Origin and ETA Port dates too", async () => {
    server[0].etd_origin_date = dmy(1);
    server[1].etd_origin_date = dmy(30);
    server[2].etd_origin_date = null;                       // no ETD: never matches an active ETD filter
    const panel = await openFilters();
    fireEvent.change(within(panel).getByLabelText("ETD Origin Date Range"), { target: { value: "next7" } });
    expect(screen.getByText("MUM51")).toBeTruthy();
    expect(screen.queryByText("MUM52")).toBeNull();
    expect(screen.queryByText("MUM53")).toBeNull();
  });

  it("builds the Warehouse and Supplier filter options from the masters (nothing hardcoded)", async () => {
    const panel = await openFilters();
    const warehouse = panel.querySelectorAll("select")[0] as HTMLSelectElement;
    const supplier = panel.querySelectorAll("select")[1] as HTMLSelectElement;
    expect(Array.from(warehouse.options).map((o) => o.textContent)).toEqual(["All Warehouses", "Mumbai", "Mumbai Ordered", "Mumbai Transit"]);
    expect(Array.from(supplier.options).map((o) => o.textContent)).toEqual(["All Suppliers", "Yinglima", "Darsh Impex India LLP Mumbai"]);
    for (const old of ["Ahmedabad Ordered", "Indore Ordered"]) expect(panel.textContent).not.toContain(old);
  });
});

describe("ImportPurchasePage: warehouses and supplier on the form (spec / General Points)", () => {
  it("hides physical warehouses on a new consignment (goods are still ordered / in transit)", async () => {
    renderImportPage("/purchase-order/import-purchase/addedit");
    await screen.findByDisplayValue("Mumbai Ordered");
    const options = Array.from((screen.getByLabelText("Warehouse") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["Select", "Mumbai Ordered", "Mumbai Transit"]);      // 'Mumbai' is a physical warehouse
  });

  it("still offers every warehouse when editing a consignment that is already in a physical warehouse", async () => {
    auth.isSuperAdmin = true;
    await loaded();
    fireEvent.click(screen.getByTestId("btn-action-ip-2"));                       // ip-2 sits in the physical 'Mumbai'
    fireEvent.click(screen.getByTestId("action-edit-ip-2"));
    const options = Array.from((screen.getByLabelText("Warehouse") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toContain("Mumbai");
    expect((screen.getByLabelText("Warehouse") as HTMLSelectElement).value).toBe("Mumbai");
  });

  it("suggests suppliers as you type (keyword suggestion) from the Supplier master", async () => {
    renderImportPage("/purchase-order/import-purchase/addedit");
    await screen.findByDisplayValue("Mumbai Ordered");
    const input = screen.getByLabelText("Supplier") as HTMLInputElement;
    expect(input.getAttribute("list")).toBeTruthy();
    const list = document.getElementById(input.getAttribute("list")!) as HTMLDataListElement;
    expect(Array.from(list.options).map((o) => o.value)).toEqual(["Yinglima", "Darsh Impex India LLP Mumbai"]);
  });

  it("only accepts a supplier that exists, and saves its exact name", async () => {
    renderImportPage("/purchase-order/import-purchase/addedit");
    await screen.findByDisplayValue("Mumbai Ordered");
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "No Such Supplier" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Consignment" }));
    expect(screen.getByText(/Select a supplier from the list/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "darsh impex india llp mumbai" } });   // any letter case
    fireEvent.change(screen.getByLabelText("Invoice / Consignment No."), { target: { value: "EXP-91" } });
    fireEvent.change(screen.getByLabelText("Conversion Rate (USD to INR)"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Customs Conversion Rate (USD to INR)"), { target: { value: "82" } });
    fireEvent.change(screen.getByLabelText("Product Search"), { target: { value: "ISL" } });
    fireEvent.click(await screen.findByRole("option", { name: "ISL350XDAN Flow Wrap Machine" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Consignment" }));
    await waitFor(() => expect(calls(apiPost, "/purchase/import-orders").some((c: any[]) => c[0] === "/purchase/import-orders")).toBe(true));
    const [, body] = calls(apiPost, "/purchase/import-orders").find((c: any[]) => c[0] === "/purchase/import-orders");
    expect(body.supplier_name).toBe("Darsh Impex India LLP Mumbai");
  });
});
