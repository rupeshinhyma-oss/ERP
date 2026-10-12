import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalPurchasePage } from "../purchase/LocalPurchasePage";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostMultipart, apiPut } from "@/lib/api";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

// The signed-in user (and the permissions they hold) is controlled per test
const auth = vi.hoisted(() => ({ isSuperAdmin: false, perms: new Set<string>() }));
vi.mock("@/lib/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks")>()),
  useAuth: () => ({
    profile: { username: "marketing", full_name: "Marketing User" },
    isSuperAdmin: auth.isSuperAdmin,
    hasPermission: (code: string) => auth.perms.has(code),
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

// ---- a tiny fake backend, so a Confirm really changes what the next list load returns ----
const RULES = {
  pending: {
    label: "Pending", next: ["confirmed"], admin_only_to: [], perm_to: { confirmed: "localpurchase.confirm" },
    reason_required_to: [], edit: "perm:localpurchase.update", delete: "admin", initial: true,
  },
  confirmed: { label: "Confirmed", next: [], edit: "none", delete: "admin", stock_in: true, action_label: "Confirm" },
};

const baseOrder = {
  supplier_id: "s1", warehouse: "Mumbai", invoice_value_ex_gst: 50000, invoice_value_inc_gst: 59000,
  packing_forwarding: 0, transport: 1000, offloading: 0, total_expenses: 1000, loading_percent: 2, remarks: null,
  bill_file_url: null, bill_file_name: null, stock_applied: false, created_by: "marketing",
  supplier_address: "6/7 Ripal Complex, Bodakdev, Ahmedabad", supplier_email: "sb@supplier.test", supplier_phone: "8799513908",
  supplier_gst: "24ACSF51727J1ZB", to_name: "Inhyma Solutions LLP (M)", to_address: "4th Floor, Wagle Estate, Thane, 400604",
  to_email: "accounts@inhyma.test", to_phone: "9000000001", to_gst: "27AAKFI9869H1ZL",
};
const item = (id: string, name: string, qty: number, rate: number) => ({
  id, product_name: name, product_code: "P", uom: "Nos", quantity: qty, unit_rate: rate, item_total: qty * rate,
  expense_per_unit: rate * 0.02, unit_landing_value: rate * 1.02,
});
const INITIAL = [
  { ...baseOrder, id: "po-1", supplier_name: "S B Inks & Packaging Co.", invoice_no: "INV-1001", invoice_date: "19-09-2026",
    status: "pending", created_date: "19-09-2026",
    items: [item("i1", "G43 Online Printer TIJ 4.3", 50, 6400), item("i2", "XF12.7 Handy Printer", 30, 3450)] },
  { ...baseOrder, id: "po-2", supplier_name: "Darsh Impex India LLP Mumbai", invoice_no: "INV-1002", invoice_date: "20-09-2026",
    status: "confirmed", stock_applied: true, created_date: "20-09-2026", warehouse: "Ahmedabad",
    items: [item("i3", "Continuous Band Sealer", 2, 25000)] },
];

let server: any[] = [];

function fakeApiGet(url: string): Promise<any> {
  if (url.startsWith("/purchase/local-orders?")) {
    const counts = { all: { count: server.length }, pending: { count: server.filter((o) => o.status === "pending").length },
      confirmed: { count: server.filter((o) => o.status === "confirmed").length } };
    return Promise.resolve({ data: { items: server, tab_counts: counts, status_rules: RULES }, meta: { total: server.length } });
  }
  const one = url.match(/^\/purchase\/local-orders\/([^/?]+)$/);
  if (one) return Promise.resolve({ data: server.find((o) => o.id === one[1]) });
  if (url.startsWith("/suppliers")) {
    return Promise.resolve({ data: [{ id: "s1", company_name: "S B Inks & Packaging Co." }, { id: "s2", company_name: "Darsh Impex India LLP Mumbai" },
      { id: "s3", company_name: "Local Traders" }] });
  }
  if (url.startsWith("/masters/warehouses")) {
    return Promise.resolve({ data: [{ name: "Mumbai", main_warehouse_id: null }, { name: "Ahmedabad", main_warehouse_id: null },
      { name: "Mumbai Ordered", main_warehouse_id: "w-mumbai" }] });
  }
  if (url.startsWith("/masters/uom")) return Promise.resolve({ data: [{ id: "u1", name: "Numbers", short_name: "Nos" }] });
  if (url.startsWith("/masters/products")) {
    return Promise.resolve({ data: [{ product_name: "Continuous Band Sealer", product_code: "CBS", standard_cost: 25000, uom_id: "u1" }] });
  }
  return Promise.resolve({ data: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.isSuperAdmin = false;
  auth.perms = new Set();
  server = JSON.parse(JSON.stringify(INITIAL));
  (apiGet as any).mockImplementation(fakeApiGet);
  (apiPost as any).mockImplementation(async (_url: string, body: any) => {
    const created = { ...baseOrder, ...body, id: "po-new", status: "pending", created_date: "06-10-2026",
      items: body.items.map((i: any, n: number) => item(`n${n}`, i.product_name, i.quantity, i.unit_rate)) };
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

const suppliersLoaded = () =>
  waitFor(() => expect(document.querySelectorAll("#local-supplier-options option").length).toBeGreaterThan(0));

const renderPurchasePage = (initialRoute = "/purchase-order/list") =>
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/purchase/localpurchase" element={<LocalPurchasePage defaultAdd={false} />} />
        <Route path="/purchase/localpurchase/addedit" element={<LocalPurchasePage defaultAdd={true} />} />
        <Route path="/purchase-order/list" element={<LocalPurchasePage defaultAdd={false} />} />
        <Route path="/purchase-order/addedit" element={<LocalPurchasePage defaultAdd={true} />} />
        <Route path="/purchase-order/addedit/:id" element={<LocalPurchasePage defaultAdd={true} />} />
        <Route path="/purchase-order/add" element={<LocalPurchasePage defaultAdd={true} />} />
      </Routes>
    </MemoryRouter>
  );

const renderLoaded = async () => {
  renderPurchasePage();
  await screen.findByText("INV-1001");
};

const today = new Date();
const dd = (n: number) => String(n).padStart(2, "0");
const TODAY = `${dd(today.getDate())}-${dd(today.getMonth() + 1)}-${today.getFullYear()}`;

describe("LocalPurchasePage list (data comes from the API)", () => {
  it("renders the page title and the Add New / Export buttons (no Import)", () => {
    renderPurchasePage();
    expect(screen.getByRole("heading", { name: "Local Purchase" })).toBeTruthy();
    expect(screen.getByTestId("btn-add-new")).toBeTruthy();
    expect(screen.getByTestId("btn-export")).toBeTruthy();
    expect(screen.queryByTestId("btn-import")).toBeNull(); // purchases are created from the form so stock can be added
  });

  it("renders toolbar with Items/Page dropdown and Search... input", () => {
    renderPurchasePage();
    expect(screen.getByText("Items/Page")).toBeTruthy();
    const select = screen.getByRole("combobox", { name: /items per page/i });
    expect((select as HTMLSelectElement).value).toBe("50");
    expect(screen.getByPlaceholderText("Search...")).toBeTruthy();
  });

  it("renders the table header columns", () => {
    renderPurchasePage();
    expect(screen.getByRole("columnheader", { name: /^Invoice [↕⇅]/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Supplier [↕⇅]/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Warehouse [↕⇅]/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Invoice Total Value/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Created By" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Added On [↕⇅]/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /^Status/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
  });

  it("shows the records the API returned, with status labels from the DB rules, and the footer", async () => {
    await renderLoaded();
    expect(screen.getByText("INV-1002")).toBeTruthy();
    expect(screen.getAllByText("S B Inks & Packaging Co.").length).toBeGreaterThan(0);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.getByText(/Showing 1 To 2 Of 2 Entries/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    // nothing is kept in the browser any more
    expect(localStorage.getItem("inhyma_local_purchase_orders")).toBeNull();
  });

  it("shows the server's message if the list cannot be loaded (no invented records)", async () => {
    (apiGet as any).mockImplementation((url: string) =>
      url.startsWith("/purchase/local-orders?") ? Promise.reject(new Error("Database is down")) : fakeApiGet(url)
    );
    renderPurchasePage();
    expect(await screen.findByText(/Database is down/)).toBeTruthy();
    expect(screen.queryByText("INV-1001")).toBeNull();
    expect(screen.getByText(/Showing 0 To 0 Of 0 Entries/i)).toBeTruthy();
  });

  it("filters purchase records when typing in search box", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "Darsh" } });
    expect(screen.queryByText("INV-1001")).toBeNull();
    expect(screen.getByText("INV-1002")).toBeTruthy();
    expect(screen.getByText(/Showing 1 To 1 Of 1 Entries/i)).toBeTruthy();
  });

  it("opens the details modal with the real supplier and buyer details from the masters", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText("INV-1001"));

    const modal = screen.getByTestId("local-purchase-details-modal");
    const scope = within(modal);
    expect(scope.getByRole("heading", { name: "Local Purchase Details" })).toBeTruthy();
    for (const section of ["Order Detail", "From", "To", "Expenses", "Product Summary"]) expect(scope.getByText(section)).toBeTruthy();
    expect(scope.getByText("marketing")).toBeTruthy(); // created_by from the API
    const text = modal.textContent || "";
    for (const real of ["24ACSF51727J1ZB", "Ripal Complex", "27AAKFI9869H1ZL", "Inhyma Solutions LLP (M)", "accounts@inhyma.test"]) {
      expect(text).toContain(real);
    }
    expect(scope.getByText("G43 Online Printer TIJ 4.3")).toBeTruthy();
    expect(scope.getByText("XF12.7 Handy Printer")).toBeTruthy();

    fireEvent.click(scope.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("local-purchase-details-modal")).toBeNull();
  });

  it("never fills in party details that the masters did not provide", async () => {
    server[0] = { ...server[0], supplier_gst: "", supplier_address: "", to_gst: "", to_name: "" };
    await renderLoaded();
    fireEvent.click(screen.getByText("INV-1001"));
    const text = screen.getByTestId("local-purchase-details-modal").textContent || "";
    for (const invented of ["24ACSF51727J1ZB", "27AAKFI9869H1ZL", "Ripal", "Supremus", "Payment.Darsh"]) expect(text).not.toContain(invented);
  });

  it("closes the details modal when Escape is pressed", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText("INV-1001"));
    expect(screen.getByTestId("local-purchase-details-modal")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("local-purchase-details-modal")).toBeNull();
  });

  it("opens the bill PDF by the purchase id from the details modal", async () => {
    const originalOpen = window.open;
    window.open = vi.fn();
    await renderLoaded();
    fireEvent.click(screen.getByText("INV-1001"));
    fireEvent.click(screen.getByTestId("btn-bill-file-pdf"));
    expect(window.open).toHaveBeenCalledWith("/purchase-order/bill-file/po-1", "_blank");
    window.open = originalOpen;
  });

  it("handles clicking sortable headers: toggles asc/desc indicators", async () => {
    await renderLoaded();
    const invoiceHeader = screen.getByRole("columnheader", { name: /^Invoice\s+[▲▼↕⇅]/ });
    fireEvent.click(invoiceHeader);
    expect(invoiceHeader.textContent).toContain("▲");
    fireEvent.click(invoiceHeader);
    expect(invoiceHeader.textContent).toContain("▼");
    const supplierHeader = screen.getByRole("columnheader", { name: /^Supplier/ });
    fireEvent.click(supplierHeader);
    expect(supplierHeader.textContent).toContain("▲");
    expect(invoiceHeader.textContent).toMatch(/[↕⇅]/);
  });
});

describe("LocalPurchasePage row actions follow the database rules and the user's role", () => {
  it("a normal user gets no Edit / Confirm / Delete on a pending purchase", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    expect(screen.getByTestId("action-menu-po-1")).toBeTruthy();
    for (const id of ["edit", "confirm", "delete"]) expect(screen.queryByTestId(`action-${id}-po-1`)).toBeNull();
  });

  it("an accounts user (update + confirm permissions) can Edit and Confirm but not Delete", async () => {
    auth.perms = new Set(["localpurchase.update", "localpurchase.confirm"]);
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    expect(screen.getByTestId("action-edit-po-1")).toBeTruthy();
    expect(screen.getByTestId("action-confirm-po-1")).toBeTruthy();
    expect(screen.queryByTestId("action-delete-po-1")).toBeNull();
    expect(screen.queryByTestId("action-download-po-1")).toBeNull();
  });

  it("an administrator also gets Delete on a pending purchase", async () => {
    auth.isSuperAdmin = true;
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    for (const id of ["edit", "confirm", "delete"]) expect(screen.getByTestId(`action-${id}-po-1`)).toBeTruthy();
  });

  it("a confirmed purchase offers Download only (nobody edits it); Delete is admin-only", async () => {
    auth.perms = new Set(["localpurchase.update", "localpurchase.confirm"]);
    const originalOpen = window.open;
    window.open = vi.fn();
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-2"));
    expect(screen.getByTestId("action-download-po-2")).toBeTruthy();
    expect(screen.getByText("Download Purchase")).toBeTruthy();
    for (const id of ["edit", "confirm", "delete", "delete-confirmed"]) expect(screen.queryByTestId(`action-${id}-po-2`)).toBeNull();

    fireEvent.click(screen.getByTestId("action-download-po-2"));
    expect(window.open).toHaveBeenCalledWith("/purchase-order/bill-file/po-2", "_blank");
    expect(screen.queryByTestId("action-menu-po-2")).toBeNull();
    window.open = originalOpen;

    cleanup();
    auth.isSuperAdmin = true;
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-2"));
    expect(screen.getByTestId("action-delete-confirmed-po-2")).toBeTruthy();
    expect(screen.queryByTestId("action-edit-po-2")).toBeNull();
  });

  it("Confirm is saved through the status API and the list is reloaded from the server", async () => {
    auth.perms = new Set(["localpurchase.confirm"]);
    await renderLoaded();
    expect(screen.getByText("Pending")).toBeTruthy();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    fireEvent.click(screen.getByTestId("action-confirm-po-1"));

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith("/purchase/local-orders/po-1/status", { status: "confirmed", reason: undefined })
    );
    await waitFor(() => expect(screen.queryByText("Pending")).toBeNull()); // came back from the (fake) server
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    expect(screen.getByTestId("action-download-po-1")).toBeTruthy();
    expect(screen.queryByTestId("action-confirm-po-1")).toBeNull();
  });

  it("leaves the status unchanged when the server refuses a confirm", async () => {
    auth.perms = new Set(["localpurchase.confirm"]);
    (apiPatch as any).mockRejectedValueOnce(new Error("Warehouse 'Mumbai' does not exist."));
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    fireEvent.click(screen.getByTestId("action-confirm-po-1"));
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("Delete asks for confirmation and calls the delete API", async () => {
    auth.isSuperAdmin = true;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    fireEvent.click(screen.getByTestId("action-delete-po-1"));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith("/purchase/local-orders/po-1"));
    await waitFor(() => expect(screen.queryByText("INV-1001")).toBeNull());
    confirmSpy.mockRestore();
  });

  it("closes the Action menu when clicking outside the menu container", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    expect(screen.getByTestId("action-menu-po-1")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("action-menu-po-1")).toBeNull();
  });
});

describe("LocalPurchasePage add / edit form", () => {
  it("opens the Add form with every field the spec lists, and no built-in default text", () => {
    renderPurchasePage();
    fireEvent.click(screen.getByTestId("btn-add-new"));

    expect(screen.getByRole("heading", { name: "Add Local Purchase" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "← BACK" })).toBeTruthy();
    for (const label of ["Warehouse", "Supplier", "Invoice No.", "Invoice Date", "Bill File", "EXPENSES", "Packing & Forwarding", "Transport",
      "Offloading", "Total Of All Expenses", "% Loading Expense (Value Based)", "PRODUCT SEARCH", "PRODUCT ITEM", "Unit Landing Rate (VB)",
      "Total Landing Rate (VB)", "Grand Total", "Remarks"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(/Invoice Total Value \(INR\) \(Basic Without GST\)/i)).toBeTruthy();
    expect(screen.getByText(/Invoice Total Value \(INR\) \(Including GST\)/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose File" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
    // remarks start empty (they used to be pre-filled with "Make all cheque payable to USER")
    expect((screen.getByPlaceholderText("Enter remarks") as HTMLTextAreaElement | HTMLInputElement).value).toBe("");
  });

  it("offers only physical warehouses and the suppliers from the Supplier master", async () => {
    renderPurchasePage("/purchase-order/addedit");
    await suppliersLoaded();
    const [warehouse] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(within(warehouse).getAllByRole("option").map((o) => o.textContent)).toEqual(["Select", "Mumbai", "Ahmedabad"]); // 'Mumbai Ordered' is not physical
    // suppliers are suggested as you type (keyword suggestion), from the Supplier master
    const supplier = screen.getByLabelText("Supplier") as HTMLInputElement;
    const list = document.getElementById(supplier.getAttribute("list")!) as HTMLDataListElement;
    expect(Array.from(list.options).map((o) => o.value)).toEqual(["S B Inks & Packaging Co.", "Darsh Impex India LLP Mumbai", "Local Traders"]);
  });

  it("opens the Invoice Date picker defaulting to today and lets you pick a date", () => {
    renderPurchasePage("/purchase-order/addedit");
    const dateInput = screen.getByLabelText("Invoice Date") as HTMLInputElement;
    expect(dateInput.value).toBe(TODAY);
    fireEvent.click(dateInput);
    expect(screen.getByTestId("datepicker-dropdown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "15" }));
    expect(screen.queryByTestId("datepicker-dropdown")).toBeNull();
    expect(dateInput.value).toBe(`15-${dd(today.getMonth() + 1)}-${today.getFullYear()}`);
  });

  it("returns to the list when ← BACK is clicked", async () => {
    renderPurchasePage("/purchase-order/addedit");
    fireEvent.click(screen.getByRole("button", { name: "← BACK" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Local Purchase" })).toBeTruthy());
  });

  const fillForm = async () => {
    await suppliersLoaded();
    const [warehouse, supplier] = screen.getAllByRole("combobox");
    fireEvent.change(warehouse, { target: { value: "Mumbai" } });
    fireEvent.change(supplier, { target: { value: "Local Traders" } });
    fireEvent.change(screen.getByText("Invoice No.").parentElement!.querySelector("input")!, { target: { value: "INV-9999" } });
    fireEvent.change(screen.getByText(/Basic Without GST/i).parentElement!.querySelector("input")!, { target: { value: "50000" } });
    fireEvent.change(screen.getByText(/Including GST/i).parentElement!.querySelector("input")!, { target: { value: "59000" } });
    fireEvent.change(screen.getByText("Transport").parentElement!.querySelector("input")!, { target: { value: "1000" } });
    fireEvent.change(screen.getByPlaceholderText("Enter Product Name / Model No"), { target: { value: "Continuous Band" } });
    fireEvent.click(await screen.findByText(/Continuous Band Sealer/i));
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } });
  };

  it("creates the purchase through the API as Pending, sending only what the user entered", async () => {
    renderPurchasePage("/purchase-order/addedit");
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, body] = (apiPost as any).mock.calls[0];
    expect(url).toBe("/purchase/local-orders");
    expect(body).toMatchObject({
      supplier_name: "Local Traders", warehouse: "Mumbai", invoice_no: "INV-9999", invoice_date: TODAY,
      invoice_value_ex_gst: 50000, invoice_value_inc_gst: 59000, transport: 1000,
    });
    expect(body.items).toEqual([expect.objectContaining({ product_name: "Continuous Band Sealer", quantity: 2, unit_rate: 25000 })]);
    for (const key of ["status", "created_by", "total_expenses", "loading_percent"]) expect(body).not.toHaveProperty(key);

    // back on the list, which shows the server's new record as Pending (it used to be saved as Confirmed)
    await waitFor(() => expect(screen.getByRole("heading", { name: "Local Purchase" })).toBeTruthy());
    expect(await screen.findByText("INV-9999")).toBeTruthy();
    expect(localStorage.getItem("inhyma_local_purchase_orders")).toBeNull();
  });

  it("stays on the form and shows the server's reason when saving fails", async () => {
    (apiPost as any).mockRejectedValueOnce(new Error("Invoice 'INV-9999' from Local Traders is already recorded."));
    renderPurchasePage("/purchase-order/addedit");
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText(/already recorded/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add Local Purchase" })).toBeTruthy();
    expect(server.some((o) => o.invoice_no === "INV-9999")).toBe(false); // nothing was invented locally
  });

  it("validates the required fields before calling the API", () => {
    renderPurchasePage("/purchase-order/addedit");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    for (const text of [/Warehouse is required/, /Supplier is required/, /Invoice No\. is required/, /Basic Value is required/]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByText(/at least one product/i)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("uploads the chosen bill file after saving", async () => {
    const { container } = renderPurchasePage("/purchase-order/addedit");
    await fillForm();
    const file = new File(["pdf"], "bill.pdf", { type: "application/pdf" });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    expect(screen.getByText("bill.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(apiPostMultipart).toHaveBeenCalledTimes(1));
    const [url, form] = (apiPostMultipart as any).mock.calls[0];
    expect(url).toBe("/purchase/local-orders/po-new/bill");
    expect((form as FormData).get("file")).toBe(file);
  });

  it("Edit opens the saved purchase in the form and saves changes with PUT", async () => {
    auth.perms = new Set(["localpurchase.update"]);
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    fireEvent.click(screen.getByTestId("action-edit-po-1"));

    expect(screen.getByRole("heading", { name: "Add Local Purchase" })).toBeTruthy();
    expect((screen.getByText("Invoice No.").parentElement!.querySelector("input") as HTMLInputElement).value).toBe("INV-1001");
    await suppliersLoaded();
    const [warehouse, supplier] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(warehouse.value).toBe("Mumbai");
    expect(supplier.value).toBe("S B Inks & Packaging Co.");
    expect(screen.getByDisplayValue("G43 Online Printer TIJ 4.3")).toBeTruthy();
    expect(screen.getByDisplayValue("XF12.7 Handy Printer")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect((apiPut as any).mock.calls[0][0]).toBe("/purchase/local-orders/po-1");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("opening /purchase-order/addedit/:id loads that purchase from the API", async () => {
    renderPurchasePage("/purchase-order/addedit/po-2");
    await waitFor(() =>
      expect((screen.getByText("Invoice No.").parentElement!.querySelector("input") as HTMLInputElement).value).toBe("INV-1002")
    );
  });
});

describe("LocalPurchasePage: unit of measure and supplier suggestion (spec)", () => {
  it("shows the product's unit next to the quantity, resolved from the UOM master", async () => {
    renderPurchasePage("/purchase-order/addedit");
    await suppliersLoaded();
    fireEvent.change(screen.getByPlaceholderText("Enter Product Name / Model No"), { target: { value: "Continuous" } });
    fireEvent.click(await screen.findByText(/Continuous Band Sealer/i));
    const unit = await screen.findByLabelText("Unit 1");
    expect(unit.textContent).toBe("Nos");
    expect(unit.closest("td")?.querySelector("input")).toBeTruthy();                  // sits in the same cell as the quantity input
  });

  it("shows the unit of a saved purchase's lines when editing", async () => {
    auth.perms = new Set(["localpurchase.update"]);
    await renderLoaded();
    fireEvent.click(screen.getByTestId("btn-action-po-1"));
    fireEvent.click(screen.getByTestId("action-edit-po-1"));
    expect((await screen.findAllByLabelText(/^Unit \d$/)).map((u) => u.textContent)).toEqual(["Nos", "Nos"]);
  });

  it("only accepts a supplier that exists, and saves its exact name whatever letter case was typed", async () => {
    renderPurchasePage("/purchase-order/addedit");
    await suppliersLoaded();
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "No Such Supplier" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByText(/Select a supplier from the list/)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();

    const [warehouse] = screen.getAllByRole("combobox");
    fireEvent.change(warehouse, { target: { value: "Mumbai" } });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "local TRADERS" } });
    fireEvent.change(screen.getByText("Invoice No.").parentElement!.querySelector("input")!, { target: { value: "INV-55" } });
    fireEvent.change(screen.getByText(/Basic Without GST/i).parentElement!.querySelector("input")!, { target: { value: "100" } });
    fireEvent.change(screen.getByText(/Invoice Total Value \(INR\) \(Including GST\)/i).parentElement!.querySelector("input")!, { target: { value: "118" } });
    fireEvent.change(screen.getByPlaceholderText("Enter Product Name / Model No"), { target: { value: "Continuous" } });
    fireEvent.click(await screen.findByText(/Continuous Band Sealer/i));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect((apiPost as any).mock.calls[0][1].supplier_name).toBe("Local Traders");
  });
});
