import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicSupplierQuotePage from "../PublicSupplierQuotePage";
import { API_BASE } from "@/lib/api";

describe("PublicSupplierQuotePage (BUG-003)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanup();
  });

  it("targets shared API_BASE (/public/rfq/:token) and renders supplier RFQ & submission cleanly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json; charset=utf-8" },
        json: async () => ({
          success: true,
          data: {
            item_id: "itm-synth-1",
            rfq_id: "rfq-synth-1",
            supplier_id: "sup-synth-1",
            supplier_name: "Synthetic Overseas Supplier Co.",
            buyer_company_name: "Synthetic Buyer Co.",
            product_name: "Synthetic Band Sealer",
            product_code: "SYN-BS-100",
            quantity: 5,
            uom_name: "Sets",
            already_submitted: false,
            submitted_quote: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => "application/json; charset=utf-8" },
        json: async () => ({
          success: true,
          data: {
            quote_number: "QT-SYNTH1",
            unit_price: 800,
            total_cost: 4000,
            currency: "USD",
          },
        }),
      });
    globalThis.fetch = fetchMock as any;

    render(
      <MemoryRouter initialEntries={["/quote/synth_signed_token_abc"]}>
        <Routes>
          <Route path="/quote/:token" element={<PublicSupplierQuotePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Synthetic Overseas Supplier Co.")).toBeTruthy();
      expect(screen.getByText("Synthetic Band Sealer")).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/public/rfq/synth_signed_token_abc`);

    const priceInput = screen.getByPlaceholderText("e.g. 450.00");
    fireEvent.change(priceInput, { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit Official Quotation/i }));

    await waitFor(() => {
      expect(screen.getByText("Quotation Submitted!")).toBeTruthy();
      expect(screen.getByText("QT-SYNTH1")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/public/rfq/synth_signed_token_abc/submit`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("handles non-JSON SPA HTML fallback gracefully without crashing with Unexpected token '<'", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "text/html; charset=utf-8" },
      json: async () => {
        throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON");
      },
    }) as any;

    render(
      <MemoryRouter initialEntries={["/quote/invalid_synth_probe"]}>
        <Routes>
          <Route path="/quote/:token" element={<PublicSupplierQuotePage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Link Unavailable")).toBeTruthy();
      expect(screen.getByText("Could not parse RFQ details.")).toBeTruthy();
    });
    expect(screen.queryByText(/Unexpected token '<'/i)).toBeNull();
  });
});
