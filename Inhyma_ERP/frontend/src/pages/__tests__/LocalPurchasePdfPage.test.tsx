import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LocalPurchasePdfPage } from "../LocalPurchasePdfPage";
import { apiGet } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
}));

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:http://localhost:3000/mock-local-purchase-bill-pdf-url");
global.URL.revokeObjectURL = vi.fn();

const PURCHASE = {
  id: "po-1", invoice_no: "INV-1001", invoice_date: "19-09-2026", supplier_name: "S B Inks & Packaging Co.", supplier_id: "s1",
  warehouse: "Mumbai", invoice_value_ex_gst: 50000, invoice_value_inc_gst: 59000, packing_forwarding: 0, transport: 1000, offloading: 0,
  total_expenses: 1000, loading_percent: 2, remarks: null, status: "pending", created_by: "marketing", created_date: "19-09-2026",
  supplier_address: "6/7 Ripal Complex", supplier_email: "sb@supplier.test", supplier_phone: "8799513908", supplier_gst: "24ACSF51727J1ZB",
  to_name: "Inhyma Solutions LLP (M)", to_address: "Wagle Estate", to_email: "accounts@inhyma.test", to_phone: "9000000001", to_gst: "27AAKFI9869H1ZL",
  items: [{ id: "i1", product_name: "Roller", product_code: "R1", uom: "Nos", quantity: 10, unit_rate: 100, item_total: 1000, expense_per_unit: 2, unit_landing_value: 102 }],
};

const renderPdf = (id = "po-1") =>
  render(
    <MemoryRouter initialEntries={[`/purchase-order/bill-file/${id}`]}>
      <Routes>
        <Route path="/purchase-order/bill-file/:id" element={<LocalPurchasePdfPage />} />
      </Routes>
    </MemoryRouter>
  );

describe("LocalPurchasePdfPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiGet as any).mockResolvedValue({ data: PURCHASE });
  });

  afterEach(() => cleanup());

  it("loads the purchase from the API and renders the toolbar and iframe preview", async () => {
    renderPdf();

    expect(screen.getByTestId("local-purchase-pdf-page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "← Back to Purchase List" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "🖨️ Print" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "⬇️ Download PDF" })).toBeTruthy();

    expect(await screen.findByText(/Bill File: INV-1001/i)).toBeTruthy();
    const iframe = await screen.findByTitle("Bill File PDF Preview");
    expect(iframe.getAttribute("src")).toBe("blob:http://localhost:3000/mock-local-purchase-bill-pdf-url");
    expect(apiGet).toHaveBeenCalledWith("/purchase/local-orders/po-1");
  });

  it("sets the document title with the invoice number", async () => {
    renderPdf();
    await waitFor(() => expect(document.title).toBe("Bill File: INV-1001"));
  });

  it("prints when the Print button is clicked", async () => {
    renderPdf();
    await screen.findByTitle("Bill File PDF Preview");
    fireEvent.click(screen.getByRole("button", { name: "🖨️ Print" }));
  });

  it("downloads when the Download PDF button is clicked", async () => {
    renderPdf();
    await screen.findByTitle("Bill File PDF Preview");
    fireEvent.click(screen.getByRole("button", { name: "⬇️ Download PDF" }));
  });

  it("shows the error and no made-up bill when the purchase cannot be loaded", async () => {
    (apiGet as any).mockRejectedValueOnce(new Error("Local purchase not found."));
    renderPdf("missing");
    expect(await screen.findByText(/Local purchase not found/)).toBeTruthy();
    expect(screen.queryByTitle("Bill File PDF Preview")).toBeNull();
    expect(screen.queryByText(/2026-27\/SO\/1534/)).toBeNull();
  });
});
