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

const CONSIGNMENT_WITH_PDF = {
  id: "ip-1", consignment_no: "MUM51", supplier_name: "Yinglima", supplier_id: "s1", warehouse: "Mumbai Ordered", ordered_date: "01-09-2026",
  etd_origin_date: "10-10-2026", eta_port_date: "25-10-2026", expected_arrival_date: "30-10-2026", conversion_rate: 80, customs_conversion_rate: 82,
  invoice_total_usd: 1000, invoice_total_inr: 80000, total_cbm: 20, total_import_duty: 6000, freight: 4000, insurance: 400, stamp_duty: 100,
  shipping_line_charges: 1000, cfs_charges: 1500, clearing_transport: 2000, offloading: 500, misc_charges: 500, total_expenses: 10000,
  gross_total_landing: 96000, loading_percent_vb: 12.5, loading_amount_per_cbm: 500, status: "pending", created_by: "marketing",
  created_date: "05-10-2026", supplier_address: "No. 18, Industrial Zone, Ningbo", supplier_email: "export@supplier.test", supplier_phone: "+86 574 0000",
  supplier_gst: "TAX-YIN-1", to_name: "Inhyma Solutions LLP (M)", to_address: "Wagle Estate, Thane", to_email: "accounts@inhyma.test",
  to_phone: "9000000001", to_gst: "27AAKFI9869H1ZL",
  bill_file: "SEALING_MACHINE_INFORMATION.pdf",
  bill_file_url: "/uploads/private/purchases/6f8a_SEALING_MACHINE_INFORMATION.pdf",
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
    (apiGet as any).mockResolvedValue({ data: CONSIGNMENT_WITH_PDF });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Blob(["mock-pdf-bytes"], { type: "application/pdf" }), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    );
  });
  afterEach(() => cleanup());

  it("loads the consignment and displays the uploaded PDF inside an iframe", async () => {
    renderPdf();
    expect(screen.getByRole("button", { name: /Back to/i })).toBeTruthy();
    expect(await screen.findByText(/MUM51/)).toBeTruthy();
    const iframe = await screen.findByTitle(/Import Bill File PDF/i);
    expect(iframe.getAttribute("src")).toBe("blob:http://localhost:3000/mock-import-bill-pdf-url");
    expect(apiGet).toHaveBeenCalledWith("/purchase/import-orders/ip-1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/purchase/import-orders/ip-1/bill-file"),
      expect.any(Object)
    );
  });

  it("sets the document title with the uploaded filename", async () => {
    renderPdf();
    await waitFor(() => expect(document.title).toContain("SEALING_MACHINE_INFORMATION.pdf"));
  });

  it("downloads the original uploaded PDF when Download button is clicked", async () => {
    renderPdf();
    await screen.findByTitle(/Import Bill File PDF/i);
    const downloadBtn = screen.getByRole("button", { name: /Download PDF/i });
    expect(downloadBtn).toBeTruthy();
    fireEvent.click(downloadBtn);
  });

  it("shows an informative message when no invoice file was uploaded without generating any fake PDF", async () => {
    (apiGet as any).mockResolvedValueOnce({
      data: { ...CONSIGNMENT_WITH_PDF, bill_file: null, bill_file_url: null },
    });
    renderPdf();
    expect(await screen.findByText(/No invoice file was uploaded for consignment MUM51/i)).toBeTruthy();
    expect(screen.queryByTitle(/Import Bill File PDF/i)).toBeNull();
  });

  it("displays a document card when the uploaded file is a docx file", async () => {
    (apiGet as any).mockResolvedValueOnce({
      data: {
        ...CONSIGNMENT_WITH_PDF,
        bill_file: "Import Purchase (inhyma).docx",
        bill_file_url: "/uploads/private/purchases/Import_Purchase.docx",
      },
    });
    (global.fetch as any).mockResolvedValueOnce(
      new Response(new Blob(["mock-docx-bytes"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), {
        status: 200,
      })
    );
    renderPdf();
    expect(await screen.findByText(/Import Purchase \(inhyma\)\.docx/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download Import Purchase \(inhyma\)\.docx/i })).toBeTruthy();
  });

  it("shows the error and no made-up bill when the consignment cannot be loaded", async () => {
    (apiGet as any).mockRejectedValueOnce(new Error("Import purchase not found."));
    renderPdf("missing");
    expect(await screen.findByText(/Import purchase not found/)).toBeTruthy();
    expect(screen.queryByTitle(/Import Bill File PDF/i)).toBeNull();
  });
});
