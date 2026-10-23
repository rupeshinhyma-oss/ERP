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

const PURCHASE_WITH_PDF = {
  id: "po-1",
  invoice_no: "INV-1001",
  invoice_date: "19-09-2026",
  supplier_name: "S B Inks & Packaging Co.",
  supplier_id: "s1",
  warehouse: "Mumbai",
  invoice_value_ex_gst: 50000,
  invoice_value_inc_gst: 59000,
  packing_forwarding: 0,
  transport: 1000,
  offloading: 0,
  total_expenses: 1000,
  loading_percent: 2,
  remarks: null,
  status: "pending",
  created_by: "marketing",
  created_date: "19-09-2026",
  supplier_address: "6/7 Ripal Complex",
  supplier_email: "sb@supplier.test",
  supplier_phone: "8799513908",
  supplier_gst: "24ACSF51727J1ZB",
  to_name: "Inhyma Solutions LLP (M)",
  to_address: "Wagle Estate",
  to_email: "accounts@inhyma.test",
  to_phone: "9000000001",
  to_gst: "27AAKFI9869H1ZL",
  bill_file: "SEALING_MACHINE_LOCAL_BILL.pdf",
  bill_file_url: "/uploads/private/purchases/SEALING_MACHINE_LOCAL_BILL.pdf",
  items: [
    {
      id: "i1",
      product_name: "Roller",
      product_code: "R1",
      uom: "Nos",
      quantity: 10,
      unit_rate: 100,
      item_total: 1000,
      expense_per_unit: 2,
      unit_landing_value: 102,
    },
  ],
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
    (apiGet as any).mockResolvedValue({ data: PURCHASE_WITH_PDF });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Blob(["mock-pdf-bytes"], { type: "application/pdf" }), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    );
  });

  afterEach(() => cleanup());

  it("loads the purchase from the API and displays the uploaded PDF inside an iframe", async () => {
    renderPdf();

    expect(screen.getByTestId("local-purchase-pdf-page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "← Back to Purchase List" })).toBeTruthy();

    const iframe = await screen.findByTitle("Bill File PDF Preview");
    expect(iframe.getAttribute("src")).toBe("blob:http://localhost:3000/mock-local-purchase-bill-pdf-url");
    expect(screen.getByRole("button", { name: "🖨️ Print" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "⬇️ Download PDF" })).toBeTruthy();
    expect(await screen.findByText(/Bill File: INV-1001/i)).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith("/purchase/local-orders/po-1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/purchase/local-orders/po-1/bill-file"),
      expect.any(Object)
    );
  });

  it("sets the document title with the uploaded bill filename", async () => {
    renderPdf();
    await waitFor(() => expect(document.title).toContain("SEALING_MACHINE_LOCAL_BILL.pdf"));
  });

  it("prints when the Print button is clicked", async () => {
    renderPdf();
    await screen.findByTitle("Bill File PDF Preview");
    fireEvent.click(screen.getByRole("button", { name: "🖨️ Print" }));
  });

  it("downloads the original uploaded PDF when the Download PDF button is clicked", async () => {
    renderPdf();
    await screen.findByTitle("Bill File PDF Preview");
    fireEvent.click(screen.getByRole("button", { name: "⬇️ Download PDF" }));
  });

  it("shows an informative message when no bill file was uploaded without generating any fake PDF", async () => {
    (apiGet as any).mockResolvedValueOnce({
      data: { ...PURCHASE_WITH_PDF, bill_file: null, bill_file_url: null },
    });
    renderPdf();
    expect(
      await screen.findByText(/No bill file was uploaded for purchase order INV-1001/i)
    ).toBeTruthy();
    expect(screen.queryByTitle("Bill File PDF Preview")).toBeNull();
  });

  it("displays a document card when the uploaded file is a docx file", async () => {
    (apiGet as any).mockResolvedValueOnce({
      data: {
        ...PURCHASE_WITH_PDF,
        bill_file: "Local_Purchase_Bill.docx",
        bill_file_url: "/uploads/private/purchases/Local_Purchase_Bill.docx",
      },
    });
    (global.fetch as any).mockResolvedValueOnce(
      new Response(
        new Blob(["mock-docx-bytes"], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        { status: 200 }
      )
    );
    renderPdf();
    expect(await screen.findByText(/Local_Purchase_Bill\.docx/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Download Local_Purchase_Bill\.docx/i })
    ).toBeTruthy();
  });

  it("shows the error and no made-up bill when the purchase cannot be loaded", async () => {
    (apiGet as any).mockRejectedValueOnce(new Error("Local purchase not found."));
    renderPdf("missing");
    expect(await screen.findByText(/Local purchase not found/)).toBeTruthy();
    expect(screen.queryByTitle("Bill File PDF Preview")).toBeNull();
  });
});
