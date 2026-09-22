import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProformaInvoicePdfPage } from "../ProformaInvoicePdfPage";

const mockGeneratePdf = vi.fn().mockReturnValue({
  output: vi.fn().mockReturnValue(new Blob(["mock-proforma-pdf"], { type: "application/pdf" })),
  save: vi.fn(),
});

vi.mock("@/lib/proformaInvoicePdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/proformaInvoicePdf")>();
  return {
    ...actual,
    generateProformaInvoicePdf: (...args: any[]) => mockGeneratePdf(...args),
  };
});

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({
    data: {
      id: "1708",
      proforma_no: "PI-MH/26-27/1714",
      proforma_date: "21-09-2026",
      expected_delivery_date: "21-09-2026",
      warehouse: "Mumbai",
      company_name: "ELITE PACK INDIA",
      city: "New Delhi",
      state: "Delhi",
      sales_person: "Dhairya Shah",
      amount_inc_gst: 182900.0,
      discount: 0.0,
      status: "admin_approved",
      payment_terms: "30 Days Credit",
      transport_name: "Self Pickup",
      created_at_formatted: "21-09-2026 03:31 PM",
      items: [
        {
          id: "item-1",
          sr_no: 1,
          product_name: "DQFXA6050 Automatic Carton Sealer",
          hsn: "8422.30.00\n18%",
          quantity: 1,
          uom: "Nos",
          rate: 155000.0,
          tax: 27900.0,
          amount: 182900.0,
        },
      ],
    },
  }),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

describe("ProformaInvoicePdfPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost:5174/mock-pi-blob-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the top toolbar matching the legacy ERP proforma view", async () => {
    render(
      <MemoryRouter initialEntries={["/proforma-invoice/download-proforma-invoice/1708"]}>
        <Routes>
          <Route path="/proforma-invoice/download-proforma-invoice/:id" element={<ProformaInvoicePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "← Back to List" })).toBeTruthy();
    expect(screen.getByText(/PI No: PI-MH\/26-27\/1714/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Print/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download PDF/i })).toBeTruthy();
  });

  it("sets document title to match tab screenshot 'PI No: PI-MH/26-27/1714'", async () => {
    render(
      <MemoryRouter initialEntries={["/proforma-invoice/download-proforma-invoice/1708"]}>
        <Routes>
          <Route path="/proforma-invoice/download-proforma-invoice/:id" element={<ProformaInvoicePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(document.title).toBe("PI No: PI-MH/26-27/1714");
    });
  });

  it("renders embedded iframe with the generated PDF blob url", async () => {
    render(
      <MemoryRouter initialEntries={["/proforma-invoice/download-proforma-invoice/1708"]}>
        <Routes>
          <Route path="/proforma-invoice/download-proforma-invoice/:id" element={<ProformaInvoicePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const iframe = screen.getByTestId("proforma-pdf-frame") as HTMLIFrameElement;
      expect(iframe).toBeTruthy();
      expect(iframe.src).toBe("blob:http://localhost:5174/mock-pi-blob-url");
    });
  });

  it("calls generateProformaInvoicePdf with saveFile: true when Download PDF is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/proforma-invoice/download-proforma-invoice/1708"]}>
        <Routes>
          <Route path="/proforma-invoice/download-proforma-invoice/:id" element={<ProformaInvoicePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    const downloadBtn = screen.getByRole("button", { name: /Download PDF/i });
    fireEvent.click(downloadBtn);

    expect(mockGeneratePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "1708",
      }),
      expect.objectContaining({
        saveFile: true,
      })
    );
  });
});
