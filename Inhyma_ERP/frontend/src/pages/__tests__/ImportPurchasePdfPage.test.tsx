import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ImportPurchasePdfPage } from "../ImportPurchasePdfPage";
import { apiGet } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: vi.fn(),
}));

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:http://localhost:3000/mock-import-bill-pdf-url");
global.URL.revokeObjectURL = vi.fn();

const CONSIGNMENT = {
  id: "ip-1", consignment_no: "MUM51", supplier_name: "Yinglima", supplier_id: "s1", warehouse: "Mumbai Ordered", ordered_date: "01-09-2026",
  etd_origin_date: "10-10-2026", eta_port_date: "25-10-2026", expected_arrival_date: "30-10-2026", conversion_rate: 80, customs_conversion_rate: 82,
  invoice_total_usd: 1000, invoice_total_inr: 80000, total_cbm: 20, total_import_duty: 6000, freight: 4000, insurance: 400, stamp_duty: 100,
  shipping_line_charges: 1000, cfs_charges: 1500, clearing_transport: 2000, offloading: 500, misc_charges: 500, total_expenses: 10000,
  gross_total_landing: 96000, loading_percent_vb: 12.5, loading_amount_per_cbm: 500, status: "pending", created_by: "marketing",
  created_date: "05-10-2026", supplier_address: "No. 18, Industrial Zone, Ningbo", supplier_email: "export@supplier.test", supplier_phone: "+86 574 0000",
  supplier_gst: "TAX-YIN-1", to_name: "Inhyma Solutions LLP (M)", to_address: "Wagle Estate, Thane", to_email: "accounts@inhyma.test",
  to_phone: "9000000001", to_gst: "27AAKFI9869H1ZL",
  items: [{ id: "i1", product_name: "Flow Wrap Machine", uom: "Nos", quantity: 10, pkg_unit_cbm: 0.5, pkg_qty: 1, item_total_cbm: 5, unit_rate_usd: 60,
    unit_rate_inr: 4800, item_total_usd: 600, duty_percent: 10, unit_import_duty: 492, item_total_duty: 4920, exp_per_unit_vb: 600,
    exp_per_unit_cb: 250, unit_landing_vb: 5892, unit_landing_cb: 5542, landing_diff: -350 }],
};

const renderPdf = (id = "ip-1") =>
  render(
    <MemoryRouter initialEntries={[`/purchase-order/import-bill-file/${id}`]}>
      <Routes>
        <Route path="/purchase-order/import-bill-file/:id" element={<ImportPurchasePdfPage />} />
      </Routes>
    </MemoryRouter>
  );

describe("ImportPurchasePdfPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiGet as any).mockResolvedValue({ data: CONSIGNMENT });
  });
  afterEach(() => cleanup());

  it("loads the consignment from the API and renders the toolbar and iframe preview", async () => {
    renderPdf();
    expect(screen.getByRole("button", { name: /Back to/i })).toBeTruthy();
    expect(await screen.findByText(/MUM51/)).toBeTruthy();
    const iframe = await screen.findByTitle(/PDF Preview/i);
    expect(iframe.getAttribute("src")).toBe("blob:http://localhost:3000/mock-import-bill-pdf-url");
    expect(apiGet).toHaveBeenCalledWith("/purchase/import-orders/ip-1");
  });

  it("sets the document title with the consignment number", async () => {
    renderPdf();
    await waitFor(() => expect(document.title).toContain("MUM51"));
  });

  it("downloads when the Download PDF button is clicked", async () => {
    renderPdf();
    await screen.findByTitle(/PDF Preview/i);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));
  });

  it("shows the error and no made-up bill when the consignment cannot be loaded", async () => {
    (apiGet as any).mockRejectedValueOnce(new Error("Import purchase not found."));
    renderPdf("missing");
    expect(await screen.findByText(/Import purchase not found/)).toBeTruthy();
    expect(screen.queryByTitle(/PDF Preview/i)).toBeNull();
  });
});
