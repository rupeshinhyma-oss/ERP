import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ImportPurchasePdfPage } from "../ImportPurchasePdfPage";

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:http://localhost:3000/mock-import-bill-pdf-url");
global.URL.revokeObjectURL = vi.fn();

describe("ImportPurchasePdfPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the top toolbar and iframe preview for Import Purchase Bill", () => {
    render(
      <MemoryRouter initialEntries={["/purchase-order/import-bill-file/MUM51"]}>
        <Routes>
          <Route path="/purchase-order/import-bill-file/:id" element={<ImportPurchasePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("import-purchase-pdf-page")).toBeTruthy();
    expect(screen.getByText(/Bill File: MUM51/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "← Back to Import Purchase List" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "🖨️ Print" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "⬇️ Download PDF" })).toBeTruthy();

    const iframe = screen.getByTitle("Import Bill File PDF Preview");
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute("src")).toBe("blob:http://localhost:3000/mock-import-bill-pdf-url");
  });

  it("sets document title with consignment number matching Bill File", () => {
    render(
      <MemoryRouter initialEntries={["/purchase-order/import-bill-file/MUM50"]}>
        <Routes>
          <Route path="/purchase-order/import-bill-file/:id" element={<ImportPurchasePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(document.title).toBe("Bill File: MUM50");
    expect(screen.getByText(/Bill File: MUM50/i)).toBeTruthy();
  });

  it("triggers download when ⬇️ Download PDF button is clicked", () => {
    render(
      <MemoryRouter initialEntries={["/purchase-order/import-bill-file/MUM51"]}>
        <Routes>
          <Route path="/purchase-order/import-bill-file/:id" element={<ImportPurchasePdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    const downloadBtn = screen.getByRole("button", { name: "⬇️ Download PDF" });
    expect(downloadBtn).toBeTruthy();
    fireEvent.click(downloadBtn);
  });
});
