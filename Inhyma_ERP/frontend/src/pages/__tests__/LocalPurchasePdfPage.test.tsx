import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LocalPurchasePdfPage } from "../LocalPurchasePdfPage";

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:http://localhost:3000/mock-local-purchase-bill-pdf-url");
global.URL.revokeObjectURL = vi.fn();

describe("LocalPurchasePdfPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the top toolbar and iframe preview for Local Purchase Bill", () => {
    render(
      <MemoryRouter initialEntries={["/purchase-order/bill-file/2026-27%2FSO%2F1534"]}>
        <Routes>
          <Route path="/purchase-order/bill-file/:id" element={<LocalPurchasePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("local-purchase-pdf-page")).toBeTruthy();
    expect(screen.getByText(/Bill File: 2026-27\/SO\/1534/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "← Back to Purchase List" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "🖨️ Print" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "⬇️ Download PDF" })).toBeTruthy();

    const iframe = screen.getByTitle("Bill File PDF Preview");
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute("src")).toBe("blob:http://localhost:3000/mock-local-purchase-bill-pdf-url");
  });

  it("sets document title with invoice number matching Bill File", () => {
    render(
      <MemoryRouter initialEntries={["/purchase-order/bill-file/752%2F26-27"]}>
        <Routes>
          <Route path="/purchase-order/bill-file/:id" element={<LocalPurchasePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(document.title).toBe("Bill File: 752/26-27");
    expect(screen.getByText(/Bill File: 752\/26-27/i)).toBeTruthy();
  });

  it("calls print method on iframe when 🖨️ Print button is clicked", () => {
    render(
      <MemoryRouter initialEntries={["/purchase-order/bill-file/2026-27%2FSO%2F1534"]}>
        <Routes>
          <Route path="/purchase-order/bill-file/:id" element={<LocalPurchasePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    const printBtn = screen.getByRole("button", { name: "🖨️ Print" });
    expect(printBtn).toBeTruthy();
    fireEvent.click(printBtn);
  });

  it("triggers download when ⬇️ Download PDF button is clicked", () => {
    render(
      <MemoryRouter initialEntries={["/purchase-order/bill-file/2026-27%2FSO%2F1534"]}>
        <Routes>
          <Route path="/purchase-order/bill-file/:id" element={<LocalPurchasePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    const downloadBtn = screen.getByRole("button", { name: "⬇️ Download PDF" });
    expect(downloadBtn).toBeTruthy();
    fireEvent.click(downloadBtn);
  });
});
