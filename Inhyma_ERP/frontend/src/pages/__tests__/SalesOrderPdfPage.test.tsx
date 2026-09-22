import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SalesOrderPdfPage } from "../SalesOrderPdfPage";

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:http://localhost:3000/mock-pdf-url");
global.URL.revokeObjectURL = vi.fn();

describe("SalesOrderPdfPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the top toolbar matching the legacy ERP sales order invoice view", () => {
    render(
      <MemoryRouter initialEntries={["/sale-order/invoice/so-3826"]}>
        <Routes>
          <Route path="/sale-order/invoice/:id" element={<SalesOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("sales-order-pdf-page")).toBeTruthy();
    expect(screen.getByTestId("pdf-order-title").textContent).toContain("Sale No: SO-MH/26-27/3826");
    expect(screen.getByText("1 / 1")).toBeTruthy();
    expect(screen.getByTestId("print-btn")).toBeTruthy();
    expect(screen.getByTestId("download-btn")).toBeTruthy();
    expect(screen.getByText("← Back")).toBeTruthy();
  });

  it("updates document.title matching the browser tab from user screenshot", () => {
    render(
      <MemoryRouter initialEntries={["/sale-order/invoice/so-3826"]}>
        <Routes>
          <Route path="/sale-order/invoice/:id" element={<SalesOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(document.title).toBe("Sale No: SO-MH/26-27/3826");
  });

  it("resolves route /sale-order/invoice/5125 matching screenshot URL", () => {
    render(
      <MemoryRouter initialEntries={["/sale-order/invoice/5125"]}>
        <Routes>
          <Route path="/sale-order/invoice/:id" element={<SalesOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("pdf-order-title").textContent).toContain("Sale No: SO-MH/26-27/3826");
    expect(document.title).toBe("Sale No: SO-MH/26-27/3826");
  });

  it("renders the iframe with blob url and triggers download on button click", () => {
    render(
      <MemoryRouter initialEntries={["/sale-order/invoice/so-3826"]}>
        <Routes>
          <Route path="/sale-order/invoice/:id" element={<SalesOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    const iframe = screen.getByTestId("pdf-preview-frame");
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute("src")).toBe("blob:http://localhost:3000/mock-pdf-url");

    const downloadBtn = screen.getByTestId("download-btn");
    expect(() => fireEvent.click(downloadBtn)).not.toThrow();

    const printBtn = screen.getByTestId("print-btn");
    expect(() => fireEvent.click(printBtn)).not.toThrow();
  });

  it("triggers window.close when clicking Back button if window.opener exists", () => {
    const closeSpy = vi.fn();
    (window as any).opener = { closed: false };
    window.close = closeSpy;

    render(
      <MemoryRouter initialEntries={["/sale-order/invoice/so-3826"]}>
        <Routes>
          <Route path="/sale-order/invoice/:id" element={<SalesOrderPdfPage />} />
        </Routes>
      </MemoryRouter>
    );

    const backBtn = screen.getByTestId("back-btn");
    fireEvent.click(backBtn);

    expect(closeSpy).toHaveBeenCalled();
    delete (window as any).opener;
  });

  it("navigates to fallback list when clicking Back button without window.opener", () => {
    render(
      <MemoryRouter initialEntries={["/sale-order/invoice/so-3826"]}>
        <Routes>
          <Route path="/sale-order/invoice/:id" element={<SalesOrderPdfPage />} />
          <Route path="/discount-payments/list" element={<div data-testid="discount-list">Discount List</div>} />
        </Routes>
      </MemoryRouter>
    );

    const backBtn = screen.getByTestId("back-btn");
    fireEvent.click(backBtn);

    expect(screen.getByTestId("discount-list")).toBeTruthy();
  });
});
