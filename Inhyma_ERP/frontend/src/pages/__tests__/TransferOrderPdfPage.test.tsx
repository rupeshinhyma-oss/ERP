import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TransferOrderPdfPage } from "../TransferOrderPdfPage";

const mockGeneratePdf = vi.fn().mockReturnValue({
  output: vi.fn().mockReturnValue(new Blob(["mock-pdf"], { type: "application/pdf" })),
  save: vi.fn(),
});

vi.mock("@/lib/stockTransferPdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stockTransferPdf")>();
  return {
    ...actual,
    generateStockTransferPdf: (...args: any[]) => mockGeneratePdf(...args),
  };
});

vi.mock("@/lib/api", () => ({
  InventoryApi: {
    listStockTransfers: vi.fn().mockResolvedValue({
      data: {
        items: [
          {
            id: "trf-52",
            sr_no: 52,
            transfer_no: "TRF-2026-052",
            transfer_date: "18-09-2026 04:37 PM",
            from_warehouse: "Ahmedabad",
            to_warehouse: "Mumbai",
            total_amount: 629534.06,
            added_by: "Akshata Wadekar",
            status: "Received",
            items: [],
          },
        ],
      },
    }),
  },
}));

describe("TransferOrderPdfPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost:5174/mock-blob-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the top toolbar matching the legacy ERP view", async () => {
    render(
      <MemoryRouter initialEntries={["/transfer/transfer-order-pdf/52"]}>
        <Routes>
          <Route path="/transfer/transfer-order-pdf/:id" element={<TransferOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "← Back to List" })).toBeTruthy();
    expect(screen.getByText("Transfer No : 52")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeTruthy();
  });

  it("sets document title to 'Transfer No : 52'", async () => {
    render(
      <MemoryRouter initialEntries={["/transfer/transfer-order-pdf/52"]}>
        <Routes>
          <Route path="/transfer/transfer-order-pdf/:id" element={<TransferOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(document.title).toBe("Transfer No : 52");
    });
  });

  it("renders embedded iframe with the generated PDF url", async () => {
    render(
      <MemoryRouter initialEntries={["/transfer/transfer-order-pdf/52"]}>
        <Routes>
          <Route path="/transfer/transfer-order-pdf/:id" element={<TransferOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const iframe = screen.getByTitle("Transfer No : 52") as HTMLIFrameElement;
      expect(iframe).toBeTruthy();
      expect(iframe.src).toBe("blob:http://localhost:5174/mock-blob-url");
    });
  });

  it("calls generateStockTransferPdf with saveFile true when Download PDF is clicked", async () => {
    render(
      <MemoryRouter initialEntries={["/transfer/transfer-order-pdf/52"]}>
        <Routes>
          <Route path="/transfer/transfer-order-pdf/:id" element={<TransferOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    const downloadBtn = screen.getByRole("button", { name: "Download PDF" });
    fireEvent.click(downloadBtn);

    expect(mockGeneratePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        sr_no: 52,
      }),
      { saveFile: true, openInNewTab: false }
    );
  });
});
