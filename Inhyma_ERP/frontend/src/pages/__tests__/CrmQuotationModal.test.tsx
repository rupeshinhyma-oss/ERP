import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { CrmLeadsPage, CrmLeadListItem, CrmLeadProductItem, CrmSalesQuotationRead, normalizeWhatsAppPhone } from "../crm/CrmLeadsPage";
import * as apiModule from "@/lib/api";
import { Auth } from "@/lib/auth";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

const mockToast = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => mockToast,
}));

const MOCK_LEADS: CrmLeadListItem[] = [
  {
    id: "lead-1",
    lead_code: "LD-2026-001",
    name: "Acme Packaging Ltd",
    original_phone: "+919876543210",
    email: "procurement@acme.com",
    company_name: "Acme Packaging Ltd",
    campaign: "Q3 Inbound",
    source_type: "company_campaign",
    pipeline_id: "pipe-1",
    pipeline_name: "Direct Sales",
    stage_id: "stage-1",
    stage_name: "New Prospect",
    assigned_to: "user-1",
    assigned_salesperson_name: "John Doe (Sales Lead)",
    status: "new",
    priority: "high",
    assignment_status: "assigned",
    created_at: "2026-10-12T10:00:00Z",
  },
];

// Actual Product Master catalog products
const MOCK_PRODUCT_MASTER_CATALOG = [
  {
    id: "prod-dar-1849",
    product_code: "DAR-01849",
    product_name: "Ink Cup Set (TDY 380C)",
    specification: "Complete ceramic ring ink cup assembly for TDY 380C pad printer",
    brand: "Darth",
    category: "Printing Consumables",
    retail_price: 14500,
    wholesale_price: 13000,
    tax_rate: 18,
    uom_id: "uom-set-uuid",
    is_sellable: true,
    is_active: true,
  },
  {
    id: "prod-inh-0758",
    product_code: "INH-00758",
    product_name: "Vacuum Pump oil",
    specification: "High grade synthetic lubrication oil for industrial vacuum systems",
    brand: "Inhyma",
    category: "Lubricants",
    retail_price: 3200,
    wholesale_price: 2900,
    tax_rate: 18,
    uom_id: "uom-ltr-uuid",
    is_sellable: true,
    is_active: true,
  },
];

const MOCK_SAVED_QUOTATION: CrmSalesQuotationRead = {
  id: "quote-1",
  quotation_number: "QT-202610-0001",
  lead_id: "lead-1",
  company_id: "comp-1",
  version: 1,
  status: "draft",
  quotation_date: "2026-10-17T10:00:00Z",
  valid_until: null,
  currency: "INR",
  customer_name_snapshot: "Acme Packaging Ltd",
  customer_phone_snapshot: "+919876543210",
  customer_email_snapshot: "procurement@acme.com",
  company_name_snapshot: "Acme Packaging Ltd",
  subtotal: 14000,
  discount_total: 0,
  tax_total: 2520,
  total_amount: 16520,
  notes: "Commercial draft",
  terms_and_conditions: "Standard 30 days validity",
  created_at: "2026-10-17T10:00:00Z",
  created_by_name: "John Doe (Sales Lead)",
  items: [
    {
      id: "item-1",
      quotation_id: "quote-1",
      product_id: "prod-dar-1849",
      position: 1,
      product_name: "Ink Cup Set (TDY 380C)",
      product_code: "DAR-01849",
      specification: "Complete ceramic ring ink cup assembly for TDY 380C pad printer",
      uom: "SET",
      include_images: false,
      include_specifications: true,
      quantity: 1,
      unit_price: 14000,
      unit_discount: 0,
      tax_rate: 18,
      taxable_amount: 14000,
      tax_amount: 2520,
      total_amount: 16520,
    },
  ],
};


describe("CRM Phase 7 — Quotation Form Cleanup, Lead Products Tab, Save & PDF Workflow", () => {
  let shouldFailProductSearch = false;
  let shouldFailQuotationFetch = false;
  let customQuotations: CrmSalesQuotationRead[] = [];
  let customLeadProducts: CrmLeadProductItem[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-pdf");
    window.URL.revokeObjectURL = vi.fn();
    shouldFailProductSearch = false;
    shouldFailQuotationFetch = false;
    customQuotations = [];
    customLeadProducts = [];

    vi.spyOn(Auth, "isSuperAdmin").mockReturnValue(true);
    vi.spyOn(Auth, "hasPermission").mockReturnValue(true);
    vi.spyOn(Auth, "getProfile").mockReturnValue({
      id: "admin-1",
      full_name: "John Doe (Sales Lead)",
      roles: ["admin"],
      permissions: ["*"],
    } as any);

    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      // 1. Product Master UOM lookup
      if (url.includes("/masters/uom")) {
        return Promise.resolve({
          data: [
            { id: "uom-nos-uuid", code: "NOS", name: "Numbers" },
            { id: "uom-set-uuid", code: "SET", name: "Set" },
            { id: "uom-ltr-uuid", code: "LTR", name: "Liters" },
          ],
        });
      }

      // 2. Existing ERP Product Master endpoint
      if (url.includes("/masters/products")) {
        if (shouldFailProductSearch) {
          return Promise.reject(new Error("Database connection timeout"));
        }
        const searchMatch = url.match(/[?&]search=([^&]+)/);
        const q = searchMatch ? decodeURIComponent(searchMatch[1]).toLowerCase() : "";
        const filtered = q
          ? MOCK_PRODUCT_MASTER_CATALOG.filter(
              (p) =>
                p.product_name.toLowerCase().includes(q) ||
                p.product_code.toLowerCase().includes(q)
            )
          : MOCK_PRODUCT_MASTER_CATALOG;
        return Promise.resolve({ data: filtered });
      }

      // 3. CRM Product Lookup endpoint
      if (url.includes("/crm/products/lookup")) {
        return Promise.resolve({
          data: {
            items: MOCK_PRODUCT_MASTER_CATALOG,
            total: MOCK_PRODUCT_MASTER_CATALOG.length,
          },
        });
      }

      // Specific lead sub-routes (products, quotations, activities)
      if (url.match(/\/crm\/leads\/[^/]+\/products/)) {
        return Promise.resolve({ data: { items: customLeadProducts, total: customLeadProducts.length } });
      }
      if (url.match(/\/crm\/leads\/[^/]+\/quotations/)) {
        if (shouldFailQuotationFetch) {
          return Promise.reject(new Error("Database MissingGreenlet: lazy loading error"));
        }
        return Promise.resolve({ data: { items: customQuotations, total: customQuotations.length } });
      }
      if (url.includes("/crm/quotations/")) {
        return Promise.resolve({ data: customQuotations[0] || MOCK_SAVED_QUOTATION });
      }
      if (url.includes("/quotations")) {
        return Promise.resolve({ data: { items: customQuotations, total: customQuotations.length } });
      }
      if (url.includes("/activities")) {
        return Promise.resolve({ data: { items: [], total: 0 } });
      }
      if (url.includes("/timeline")) {
        return Promise.resolve({ data: { activities: [], total: 0 } });
      }
      if (url.includes("/follow-ups")) {
        return Promise.resolve({ data: { items: [], total: 0 } });
      }
      if (url.includes("/crm/pipelines")) {
        return Promise.resolve({
          data: [
            {
              id: "pipe-1",
              name: "Direct Sales",
              stages: [{ id: "stage-1", name: "New Prospect", stage_order: 1, is_initial: true, is_active: true }],
            },
          ],
        });
      }
      if (url.match(/\/crm\/leads\/[a-zA-Z0-9_-]+$/)) {
        return Promise.resolve({ data: MOCK_LEADS[0] });
      }
      if (url.includes("/crm/leads")) {
        return Promise.resolve({
          data: {
            items: MOCK_LEADS,
            total: 1,
            page: 1,
            page_size: 25,
            total_pages: 1,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  afterEach(() => {
    cleanup();
  });

  const openQuotationModal = async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Wait for leads table to load
    await waitFor(() => {
      expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1);
    });

    // Open lead drawer by clicking History & Details
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    // Switch to Quotations tab in drawer
    await waitFor(() => {
      expect(screen.getByText(/Quotations/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Quotations/i));

    // Click "+ New Quotation" or "+ Create First Quotation"
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /\+ New Quotation|\+ Create First Quotation/i }).length).toBeGreaterThan(0);
    });
    const newQuoteBtns = screen.getAllByRole("button", { name: /\+ New Quotation|\+ Create First Quotation/i });
    fireEvent.click(newQuoteBtns[0]);

    // Verify modal title is displayed
    await screen.findByRole("heading", { name: "Create Quotation" });
  };

  it("PART 1: removed fields (Reference Number, Reference Date, Validity Date, Payment Terms, Salesperson, Lead Owner) no longer appear in creation form", async () => {
    await openQuotationModal();

    // Contextual display exists
    expect(screen.getByRole("heading", { name: "Create Quotation" })).toBeTruthy();
    expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("QTN-PREVIEW (Auto)")).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();

    // The 6 removed fields MUST NOT exist in creation form
    expect(screen.queryByPlaceholderText("e.g. RFQ-2026-981")).toBeNull();
    expect(screen.queryByText(/Reference Number/i)).toBeNull();
    expect(screen.queryByText(/Reference Date/i)).toBeNull();
    expect(screen.queryByText(/Validity Date/i)).toBeNull();
    expect(screen.queryByText(/Payment Terms/i)).toBeNull();
    expect(screen.queryByText("🔒 Lead Owner")).toBeNull();

    // Necessary core items remain
    expect(screen.getByPlaceholderText(/Search Product Master by product name or code/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Add client-facing notes or remarks/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Enter terms and conditions/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save Draft Quotation|Save Quotation/i })).toBeTruthy();
  });

  it("PART 1 & 2: lead owner remains unchanged when a quotation is created", async () => {
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: { id: "quote-1", quotation_number: "QT-202610-0001", version: 1 },
    } as any);

    await openQuotationModal();

    // Add product
    const searchInput = screen.getByPlaceholderText(/Search Product Master by product name or code/i);
    fireEvent.change(searchInput, { target: { value: "DAR-01849" } });
    await waitFor(() => expect(screen.getByText("+ Select")).toBeTruthy());
    fireEvent.click(screen.getByText("+ Select"));

    // Enter price and tax
    fireEvent.change(screen.getByPlaceholderText("Enter price *"), { target: { value: "14000" } });
    fireEvent.change(screen.getByDisplayValue("-- Tax * --"), { target: { value: "18" } });

    // Click save
    fireEvent.click(screen.getByRole("button", { name: /Save Draft Quotation|Save Quotation/i }));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalled();
      const payload = postSpy.mock.calls[0][1] as any;
      // Quotation creation payload must NOT alter lead owner or pass salesperson overwrite
      expect(payload.assigned_to).toBeUndefined();
      expect(payload.owner_id).toBeUndefined();
    });
  });

  it("PART A: Products tab is removed from CRM lead detail drawer while Overview, Activities, Follow-ups, Quotations, and History remain", async () => {
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Open lead drawer
    await waitFor(() => {
      expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1);
    });
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    // Verify remaining tabs are present in drawer
    await waitFor(() => {
      expect(screen.getByText(/^Overview$/i)).toBeTruthy();
      expect(screen.getByText(/^Activities/i)).toBeTruthy();
      expect(screen.getByText(/^Follow-ups/i)).toBeTruthy();
      expect(screen.getByText(/^Quotations/i)).toBeTruthy();
      expect(screen.getByText(/^History$/i)).toBeTruthy();
    });

    // Verify Products tab is strictly removed from the drawer
    expect(screen.queryByRole("button", { name: /^Products/i })).toBeNull();
  });

  it("PART A & C: Quotations tab remains fully functional when Products tab is removed", async () => {
    customQuotations = [MOCK_SAVED_QUOTATION];
    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Open lead drawer
    await waitFor(() => {
      expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1);
    });
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    // Click Quotations tab
    await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations \(1\)/i));

    // Verify Quotation appears in Quotations tab
    await waitFor(() => {
      expect(screen.getByText("QT-202610-0001")).toBeTruthy();
      expect(screen.getByText("v1")).toBeTruthy();
      expect(screen.getByText("draft")).toBeTruthy();
    });
  });

  it("PART 1 & 3: does not silently prefill commercial values; user must enter Price and Tax % explicitly", async () => {
    await openQuotationModal();

    const searchInput = screen.getByPlaceholderText(/Search Product Master by product name or code/i);
    fireEvent.change(searchInput, { target: { value: "DAR-01849" } });

    await waitFor(() => {
      expect(screen.getByText("+ Select")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("+ Select"));

    // Price input must NOT be silently prefilled with 14500
    const priceInput = screen.getByPlaceholderText("Enter price *") as HTMLInputElement;
    expect(priceInput.value).toBe("");

    // Catalog price is displayed only as a clearly labeled reference
    expect(screen.getByText("Ref: ₹14,500")).toBeTruthy();

    // Tax select must NOT be silently preselected
    const taxSelect = screen.getByDisplayValue("-- Tax * --") as HTMLSelectElement;
    expect(taxSelect.value).toBe("");
  });

  it("PART 3: validates required inputs and saves quotation with clean payload", async () => {
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: {
        id: "quote-1",
        quotation_number: "QT-202610-0001",
        version: 1,
      },
    } as any);

    await openQuotationModal();

    // Add item
    const searchInput = screen.getByPlaceholderText(/Search Product Master by product name or code/i);
    fireEvent.change(searchInput, { target: { value: "DAR-01849" } });
    await waitFor(() => expect(screen.getByText("+ Select")).toBeTruthy());
    fireEvent.click(screen.getByText("+ Select"));

    vi.spyOn(apiModule, "apiDownloadBlob").mockResolvedValue({
      blob: new Blob(["dummy-pdf"], { type: "application/pdf" }),
      filename: "QT-202610-0001_v1.pdf",
    });

    const saveBtn = screen.getByRole("button", { name: /Save Draft Quotation|Save Quotation/i });

    // 1. Missing price -> rejected
    fireEvent.click(saveBtn);
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Unit price must be manually entered and greater than 0"),
      "error"
    );

    // Enter valid price
    const priceInput = screen.getByPlaceholderText("Enter price *");
    fireEvent.change(priceInput, { target: { value: "14000" } });

    // 2. Missing tax rate -> rejected
    fireEvent.click(saveBtn);
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Please explicitly select or enter a tax rate"),
      "error"
    );

    // Select tax rate
    const taxSelect = screen.getByDisplayValue("-- Tax * --");
    fireEvent.change(taxSelect, { target: { value: "18" } });

    // Save successfully
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        "/api/v1/crm/leads/lead-1/quotations",
        expect.objectContaining({
          currency: "INR",
          items: [
            expect.objectContaining({
              product_id: "prod-dar-1849",
              quantity: 1,
              unit_price: 14000,
              tax_rate: 18,
              uom: "SET",
            }),
          ],
        })
      );
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("saved successfully"), "success");
    });
  });

  it("PART 3: save failure preserves entered form values, keeps modal open, and shows error message", async () => {
    vi.spyOn(apiModule, "apiPost").mockRejectedValue(new Error("Network connection dropped"));

    await openQuotationModal();

    // Add item
    const searchInput = screen.getByPlaceholderText(/Search Product Master by product name or code/i);
    fireEvent.change(searchInput, { target: { value: "DAR-01849" } });
    await waitFor(() => expect(screen.getByText("+ Select")).toBeTruthy());
    fireEvent.click(screen.getByText("+ Select"));

    // Enter price and tax
    const priceInput = screen.getByPlaceholderText("Enter price *") as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "15500" } });

    const taxSelect = screen.getByDisplayValue("-- Tax * --");
    fireEvent.change(taxSelect, { target: { value: "18" } });

    // Enter notes
    const notesInput = screen.getByPlaceholderText(/Add client-facing notes or remarks/i) as HTMLTextAreaElement;
    fireEvent.change(notesInput, { target: { value: "Special bulk discount requested." } });

    // Click Save
    const saveBtn = screen.getByRole("button", { name: /Save Draft Quotation|Save Quotation/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      // Toast displays error message
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Network connection dropped"), "error");
    });

    // Form MUST remain open
    expect(screen.getByRole("heading", { name: "Create Quotation" })).toBeTruthy();

    // Entered values MUST be preserved!
    expect(priceInput.value).toBe("15500");
    expect(notesInput.value).toBe("Special bulk discount requested.");
    expect(screen.getByText("DAR-01849")).toBeTruthy();
  });

  it("PART 4: saved quotation appears in lead Quotations tab and has clear Download PDF action", async () => {
    customQuotations = [MOCK_SAVED_QUOTATION];
    const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob").mockResolvedValue({
      blob: new Blob(["dummy-pdf"], { type: "application/pdf" }),
      filename: "Quotation-QT-202610-0001-v1.pdf",
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Open lead drawer
    await waitFor(() => {
      expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1);
    });
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    // Click Quotations tab
    await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations \(1\)/i));

    // Saved quotation card appears
    await waitFor(() => {
      expect(screen.getByText("QT-202610-0001")).toBeTruthy();
      expect(screen.getByText("v1")).toBeTruthy();
      expect(screen.getByText("draft")).toBeTruthy();
      expect(screen.getByText("₹16,520.00")).toBeTruthy();
    });

    // PDF Download button is available on the saved quotation
    const pdfBtn = screen.getByTestId("download-quote-pdf-quote-1");
    expect(pdfBtn).toBeTruthy();
    fireEvent.click(pdfBtn);

    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalledWith(expect.stringContaining("/crm/quotations/quote-1/pdf"));
    });
  });

  it("PART 1: displays actual API error banner when Product Master request fails", async () => {
    shouldFailProductSearch = true;
    await openQuotationModal();

    const searchInput = screen.getByPlaceholderText(/Search Product Master by product name or code/i);
    fireEvent.change(searchInput, { target: { value: "BrokenProduct" } });

    await waitFor(() => {
      expect(
        screen.getByText(/Database connection timeout/i)
      ).toBeTruthy();
    });
  });

  it("PHASE 8: provides Email and WhatsApp sharing actions on quotation card and records share activity", async () => {
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-pdf");
    window.URL.revokeObjectURL = vi.fn();
    customQuotations = [MOCK_SAVED_QUOTATION];
    const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob").mockResolvedValue({
      blob: new Blob(["dummy-pdf-content"], { type: "application/pdf" }),
      filename: "Quotation-QT-202610-0001-v1.pdf",
    });
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({ data: { success: true, activity_id: "act-123" } });
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as any);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Open lead drawer
    await waitFor(() => {
      expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1);
    });
    const detailButtons = screen.getAllByRole("button", { name: /^History & Details$/i });
    fireEvent.click(detailButtons[0]);

    // Click Quotations tab
    await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations \(1\)/i));

    // Verify Email and WhatsApp buttons appear on the quotation card
    await waitFor(() => {
      expect(screen.getByTestId("email-quote-btn-quote-1")).toBeTruthy();
      expect(screen.getByTestId("wa-quote-btn-quote-1")).toBeTruthy();
    });

    // 1. Click Email button
    const emailBtn = screen.getByTestId("email-quote-btn-quote-1");
    fireEvent.click(emailBtn);

    // Phase 10: Modal appears asking user to choose client
    await waitFor(() => {
      expect(screen.getByTestId("choose-gmail-btn")).toBeTruthy();
      expect(screen.getByTestId("choose-default-email-btn")).toBeTruthy();
    });

    // Choose Gmail
    fireEvent.click(screen.getByTestId("choose-gmail-btn"));

    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalledWith(expect.stringContaining("/crm/quotations/quote-1/pdf"));
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("mail.google.com/mail"),
        "_blank",
        expect.any(String)
      );
      // Verify Gmail subject and professional body
      const emailCall = openSpy.mock.calls.find((c: any[]) => typeof c[0] === "string" && c[0].includes("mail.google.com"));
      expect(emailCall).toBeDefined();
      const emailUrl = new URL(emailCall![0] as string);
      expect(emailUrl.searchParams.get("su")).toBe("Quotation QT-202610-0001 (v1) — Inhyma Solutions LLP");
      const emailBody = emailUrl.searchParams.get("body") || "";
      expect(emailBody).toContain("Dear Acme Packaging Ltd,");
      expect(emailBody).toContain("Please find attached our quotation QT-202610-0001 (v1), amounting to INR 16,520.00.");
      expect(emailBody).toContain("Regards,\nInhyma Solutions LLP");
      expect(emailBody).not.toContain("The official quotation PDF has been downloaded to your device");
      expect(emailBody).not.toContain("Please review and let us know if you have any questions");

      expect(postSpy).toHaveBeenCalledWith(
        "/api/v1/crm/quotations/quote-1/share-activity",
        expect.objectContaining({
          channel: "email",
          outcome: "opened",
          version: 1,
        })
      );
    });

    // 2. Click WhatsApp button (no PDF download side effect)
    const waBtn = screen.getByTestId("wa-quote-btn-quote-1");
    fireEvent.click(waBtn);

    await waitFor(() => {
      // Must NOT invoke PDF download on WhatsApp click
      expect(downloadSpy).toHaveBeenCalledTimes(1); // Only 1 from email, not called on WhatsApp
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("wa.me"),
        "_blank",
        expect.any(String)
      );
      // Validate customer-facing message structure
      const lastCall = openSpy.mock.calls[openSpy.mock.calls.length - 1];
      const openedUrl = lastCall[0] as string;
      const urlObj = new URL(openedUrl);
      const textParam = urlObj.searchParams.get("text") || "";

      expect(textParam).toContain("Dear Acme Packaging Ltd,");
      expect(textParam).toContain("Please find our quotation QT-202610-0001 (v1) for INR 16,520.00.");
      expect(textParam).toContain("Regards,\nInhyma Solutions LLP");
      expect(textParam).not.toContain("Please review and let us know if you have any questions");
      expect(textParam).not.toContain("Quotation No:");

      // Verify NO internal dumps or line-item lists
      expect(textParam).not.toContain("Ink Cup Set");
      expect(textParam).not.toContain("lead-1");
      expect(textParam).not.toContain("Q3 Inbound");

      // Toast confirms WhatsApp chat opened
      expect(mockToast).toHaveBeenCalledWith("WhatsApp chat opened with quotation details.", "info");

      expect(postSpy).toHaveBeenCalledWith(
        "/api/v1/crm/quotations/quote-1/share-activity",
        expect.objectContaining({
          channel: "whatsapp",
          outcome: "opened",
          version: 1,
          details: "WhatsApp chat opened with quotation details",
        })
      );
    });
  });

  it("WHATSAPP FIX: normalizes international and local phone numbers correctly without blindly prepending 91", () => {
    // 10 digits Indian local: prepends 91
    expect(normalizeWhatsAppPhone("9876543210")).toBe("919876543210");
    // 11 digits with 0 trunk prefix: strips 0, prepends 91
    expect(normalizeWhatsAppPhone("09876543210")).toBe("919876543210");
    // With explicit +91: retains 91
    expect(normalizeWhatsAppPhone("+91 98765 43210")).toBe("919876543210");
    // US number with +1: retains 14155552671, does NOT prepend 91
    expect(normalizeWhatsAppPhone("+1 (415) 555-2671")).toBe("14155552671");
    // UK number with +44: retains 447911123456, does NOT prepend 91
    expect(normalizeWhatsAppPhone("+44 7911 123456")).toBe("447911123456");
    // UAE number with +971: retains 971501234567, does NOT prepend 91
    expect(normalizeWhatsAppPhone("+971 50 123 4567")).toBe("971501234567");
    // Already has 11 digits without + (US): keeps as-is, does NOT prepend 91
    expect(normalizeWhatsAppPhone("14155552671")).toBe("14155552671");
    // Already has 12 digits without + (UK): keeps as-is, does NOT prepend 91
    expect(normalizeWhatsAppPhone("447911123456")).toBe("447911123456");
    // With 00 international prefix: strips 00 and keeps country code
    expect(normalizeWhatsAppPhone("0014155552671")).toBe("14155552671");
    expect(normalizeWhatsAppPhone("00447911123456")).toBe("447911123456");
    // Invalid / too short
    expect(normalizeWhatsAppPhone("12345")).toBeNull();
    expect(normalizeWhatsAppPhone("")).toBeNull();
    expect(normalizeWhatsAppPhone(null)).toBeNull();
    expect(normalizeWhatsAppPhone(undefined)).toBeNull();
  });

  it("WHATSAPP FIX: opens WhatsApp directly via wa.me URL without native navigator.share, does NOT download PDF, and has concise copy", async () => {
    window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-pdf");
    window.URL.revokeObjectURL = vi.fn();
    customQuotations = [MOCK_SAVED_QUOTATION];
    const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob");
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({ data: { success: true } });
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as any);

    // Provide mock navigator.share and canShare to verify they are NEVER invoked
    const mockShare = vi.fn().mockResolvedValue(undefined);
    const mockCanShare = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "canShare", {
      value: mockCanShare,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: mockShare,
      configurable: true,
      writable: true,
    });

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    // Open lead drawer & quotations
    await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
    await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations \(1\)/i));

    await waitFor(() => expect(screen.getByTestId("wa-quote-btn-quote-1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("wa-quote-btn-quote-1"));

    await waitFor(() => {
      // Must NOT call apiDownloadBlob or download PDF
      expect(downloadSpy).not.toHaveBeenCalled();
      // Must NOT invoke navigator.share or canShare
      expect(mockShare).not.toHaveBeenCalled();
      // Must directly open wa.me
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("https://wa.me/919876543210?text="),
        "_blank",
        "noopener,noreferrer"
      );
      // Validates toast notification
      expect(mockToast).toHaveBeenCalledWith(
        "WhatsApp chat opened with quotation details.",
        "info"
      );
      // Validates activity logging
      expect(postSpy).toHaveBeenCalledWith(
        "/api/v1/crm/quotations/quote-1/share-activity",
        expect.objectContaining({
          channel: "whatsapp",
          outcome: "opened",
          recipient: "+919876543210",
          details: "WhatsApp chat opened with quotation details",
        })
      );
    });

    // Cleanup navigator mocks
    delete (navigator as any).canShare;
    delete (navigator as any).share;
  });

  it("WHATSAPP FIX: handles missing/invalid phone number without downloading PDF or opening WhatsApp", async () => {
    customQuotations = [{
      ...MOCK_SAVED_QUOTATION,
      customer_phone_snapshot: "123", // invalid short phone
    }];
    const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob");
    const openSpy = vi.spyOn(window, "open");

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
    await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations \(1\)/i));

    await waitFor(() => expect(screen.getByTestId("wa-quote-btn-quote-1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("wa-quote-btn-quote-1"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Missing or invalid customer phone number. Please update lead contact details to share via WhatsApp.",
        "warning"
      );
      expect(downloadSpy).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  it("WHATSAPP FIX: clicking WhatsApp does not call PDF download endpoint and records opened status, never sent/delivered", async () => {
    const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob");
    customQuotations = [MOCK_SAVED_QUOTATION];
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({ data: { success: true } });
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as any);

    render(
      <BrowserRouter>
        <CrmLeadsPage />
      </BrowserRouter>
    );

    await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
    await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/Quotations \(1\)/i));

    await waitFor(() => expect(screen.getByTestId("wa-quote-btn-quote-1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("wa-quote-btn-quote-1"));

    await waitFor(() => {
      expect(downloadSpy).not.toHaveBeenCalled();
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("https://wa.me/919876543210?text="),
        "_blank",
        "noopener,noreferrer"
      );
      expect(postSpy).toHaveBeenCalledWith(
        "/api/v1/crm/quotations/quote-1/share-activity",
        expect.objectContaining({
          channel: "whatsapp",
          outcome: "opened",
        })
      );
      // Ensure sent or delivered is NEVER recorded
      expect(postSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: "sent" })
      );
      expect(postSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: "delivered" })
      );
    });
  });

  it("PHASE 8: shows clear warning in quotation editor when company and contact details are genuinely missing", async () => {
    // Lead with missing company and missing contact info
    MOCK_LEADS[0] = {
      ...MOCK_LEADS[0],
      company_id: null,
      company_name: null,
      email: null,
      original_phone: "",
      normalized_phone: null,
    };

    await openQuotationModal();

    await waitFor(() => {
      expect(screen.getByTestId("quotation-missing-details-warning")).toBeTruthy();
      expect(screen.getByText(/Missing Customer Details:/i)).toBeTruthy();
    });
  });

  describe("CRM Quotation Creation & PDF Download Scoping (Issue Resolution)", () => {
    it("Clicking '+ New Quotation' opens the quotation form and does NOT trigger PDF download", async () => {
      customQuotations = [MOCK_SAVED_QUOTATION];
      const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob");

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
      fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
      await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
      fireEvent.click(screen.getByText(/Quotations \(1\)/i));

      // Button "+ New Quotation" is visible
      const newQuoteBtn = await screen.findByTestId("crm-new-quotation-btn");
      expect(newQuoteBtn).toBeTruthy();

      // Click "+ New Quotation"
      fireEvent.click(newQuoteBtn);

      // Form opens
      await screen.findByRole("heading", { name: "Create Quotation" });
      expect(screen.getByPlaceholderText(/Search Product Master by product name or code/i)).toBeTruthy();

      // Verify PDF download was NEVER called
      expect(downloadSpy).not.toHaveBeenCalled();
    });

    it("Clicking '+ Create First Quotation' opens the same quotation form and does NOT trigger PDF download", async () => {
      customQuotations = []; // Empty state
      const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob");

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
      fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
      await waitFor(() => expect(screen.getByText(/Quotations \(0\)/i)).toBeTruthy());
      fireEvent.click(screen.getByText(/Quotations \(0\)/i));

      // Empty state displays "+ Create First Quotation"
      const createFirstBtn = await screen.findByTestId("crm-create-first-quotation-btn");
      expect(createFirstBtn).toBeTruthy();

      // Click "+ Create First Quotation"
      fireEvent.click(createFirstBtn);

      // Same form opens
      await screen.findByRole("heading", { name: "Create Quotation" });
      expect(screen.getByPlaceholderText(/Search Product Master by product name or code/i)).toBeTruthy();

      // Verify PDF download was NEVER called
      expect(downloadSpy).not.toHaveBeenCalled();
    });

    it("Saving a draft persists quotation and displays it in Quotations tab WITHOUT automatic PDF download", async () => {
      const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
        data: {
          id: "quote-no-auto-pdf",
          quotation_number: "SQ-202610-0088",
          version: 1,
          total_amount: 16520,
        },
      } as any);
      const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob");

      await openQuotationModal();

      // Select a product
      const searchInput = screen.getByPlaceholderText(/Search Product Master by product name or code/i);
      fireEvent.change(searchInput, { target: { value: "DAR-01849" } });
      await waitFor(() => expect(screen.getByText("+ Select")).toBeTruthy());
      fireEvent.click(screen.getByText("+ Select"));

      // Enter price and tax rate
      fireEvent.change(screen.getByPlaceholderText("Enter price *"), { target: { value: "14000" } });
      fireEvent.change(screen.getByDisplayValue("-- Tax * --"), { target: { value: "18" } });

      // Click Save Draft Quotation
      const saveBtn = screen.getByRole("button", { name: /Save Draft Quotation/i });
      fireEvent.click(saveBtn);

      // 1. Verify quotation saved via apiPost
      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith(
          expect.stringContaining("/crm/leads/lead-1/quotations"),
          expect.anything()
        );
      });

      // 2. Verify modal closed
      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: "Create Quotation" })).toBeNull();
      });

      // 3. Verify success toast shown
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("saved successfully"), "success");

      // 4. Verify PDF download was NOT called automatically
      expect(downloadSpy).not.toHaveBeenCalled();
    });

    it("Clicking Download PDF on a saved quotation explicitly downloads the saved quotation PDF", async () => {
      window.URL.createObjectURL = vi.fn().mockReturnValue("blob:download-saved-pdf");
      window.URL.revokeObjectURL = vi.fn();
      customQuotations = [MOCK_SAVED_QUOTATION];
      const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob").mockResolvedValue({
        blob: new Blob(["dummy-pdf"], { type: "application/pdf" }),
        filename: "Quotation-QT-202610-0001-v1.pdf",
      });

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      // Open lead drawer & Quotations tab
      await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
      fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
      await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
      fireEvent.click(screen.getByText(/Quotations \(1\)/i));

      // Saved quotation card appears with explicit Download PDF button
      const downloadBtn = await screen.findByTestId("download-quote-pdf-quote-1");
      expect(downloadBtn).toBeTruthy();
      expect(downloadBtn.textContent).toContain("Download PDF");

      // Explicitly click Download PDF
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(downloadSpy).toHaveBeenCalledWith(expect.stringContaining("/crm/quotations/quote-1/pdf"));
        expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("downloaded successfully"), "success");
      });
    });

    it("A salesperson cannot open or download another salesperson's quotation (unauthorized / forbidden)", async () => {
      // When API returns 403 Forbidden for an out-of-scope quotation access
      const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob").mockRejectedValue({
        response: { status: 403, data: { detail: "Access denied to out-of-scope lead quotation" } },
        message: "Access denied to out-of-scope lead quotation",
      });

      customQuotations = [
        {
          ...MOCK_SAVED_QUOTATION,
          id: "quote-other-rep",
          quotation_number: "SQ-OTHER-001",
        },
      ];

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
      fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
      await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
      fireEvent.click(screen.getByText(/Quotations \(1\)/i));

      const downloadBtn = await screen.findByTestId("download-quote-pdf-quote-other-rep");
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(downloadSpy).toHaveBeenCalledWith(expect.stringContaining("/crm/quotations/quote-other-rep/pdf"));
        expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Access denied"), "error");
      });
    });
  });

  describe("PHASE 10: Email Client Selection & Gmail vs Default Email App Flow", () => {
    it("opens Default Email App with mailto URL when Default Email App is selected", async () => {
      window.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-pdf");
      window.URL.revokeObjectURL = vi.fn();
      customQuotations = [MOCK_SAVED_QUOTATION];
      const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob").mockResolvedValue({
        blob: new Blob(["dummy-pdf-content"], { type: "application/pdf" }),
        filename: "Quotation-QT-202610-0001-v1.pdf",
      });
      const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({ data: { success: true } });

      // Mock window.location
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = { ...originalLocation, href: "" } as any;

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      // Open drawer & Quotations tab
      await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
      fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
      await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
      fireEvent.click(screen.getByText(/Quotations \(1\)/i));

      // Click Email button
      await waitFor(() => expect(screen.getByTestId("email-quote-btn-quote-1")).toBeTruthy());
      fireEvent.click(screen.getByTestId("email-quote-btn-quote-1"));

      // Verify modal
      await waitFor(() => {
        expect(screen.getByTestId("choose-default-email-btn")).toBeTruthy();
      });

      // Click Default Email App
      fireEvent.click(screen.getByTestId("choose-default-email-btn"));

      await waitFor(() => {
        expect(downloadSpy).toHaveBeenCalledWith(expect.stringContaining("/crm/quotations/quote-1/pdf"));
        expect(window.location.href).toContain("mailto:procurement%40acme.com");
        expect(window.location.href).toContain(encodeURIComponent("Quotation QT-202610-0001 (v1) — Inhyma Solutions LLP"));
        expect(window.location.href).toContain(encodeURIComponent("Please find attached our quotation QT-202610-0001 (v1), amounting to INR 16,520.00."));
        expect(window.location.href).not.toContain(encodeURIComponent("The official quotation PDF has been downloaded to your device"));
        expect(window.location.href).not.toContain(encodeURIComponent("Please review and let us know if you have any questions"));
        expect(mockToast).toHaveBeenCalledWith(
          expect.stringContaining("Quotation PDF downloaded. Email composer opened for procurement@acme.com — please attach the downloaded PDF before sending."),
          "info"
        );
        expect(postSpy).toHaveBeenCalledWith(
          "/api/v1/crm/quotations/quote-1/share-activity",
          expect.objectContaining({
            channel: "email",
            outcome: "opened",
            details: "Default desktop email client opened; PDF downloaded for manual attachment",
          })
        );
        // Ensure sent or delivered is NEVER recorded
        expect(postSpy).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ outcome: "sent" })
        );
        expect(postSpy).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ outcome: "delivered" })
        );
      });

      window.location = originalLocation;
    });

    it("allows canceling Email Client Selection modal without downloading or opening composers", async () => {
      customQuotations = [MOCK_SAVED_QUOTATION];
      const downloadSpy = vi.spyOn(apiModule, "apiDownloadBlob");

      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
      fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
      await waitFor(() => expect(screen.getByText(/Quotations \(1\)/i)).toBeTruthy());
      fireEvent.click(screen.getByText(/Quotations \(1\)/i));

      await waitFor(() => expect(screen.getByTestId("email-quote-btn-quote-1")).toBeTruthy());
      fireEvent.click(screen.getByTestId("email-quote-btn-quote-1"));

      await waitFor(() => expect(screen.getByTestId("cancel-email-client-modal")).toBeTruthy());
      fireEvent.click(screen.getByTestId("cancel-email-client-modal"));

      await waitFor(() => {
        expect(screen.queryByTestId("choose-gmail-btn")).toBeNull();
        expect(downloadSpy).not.toHaveBeenCalled();
      });
    });

    it("displays an error state and allows retry when quotation request fails rather than showing 'No Quotations Created Yet'", async () => {
      shouldFailQuotationFetch = true;
      render(
        <BrowserRouter>
          <CrmLeadsPage />
        </BrowserRouter>
      );

      // Open drawer & Quotations tab
      await waitFor(() => expect(screen.getAllByText("Acme Packaging Ltd").length).toBeGreaterThanOrEqual(1));
      fireEvent.click(screen.getAllByRole("button", { name: /^History & Details$/i })[0]);
      await waitFor(() => expect(screen.getByText(/Quotations \(0\)/i)).toBeTruthy());
      fireEvent.click(screen.getByText(/Quotations \(0\)/i));

      // Verify error state is shown and NOT 'No Quotations Created Yet'
      await waitFor(() => {
        expect(screen.getByTestId("crm-quotations-error-container")).toBeTruthy();
        expect(screen.getByText("Failed to Load Quotations")).toBeTruthy();
        expect(screen.getByText(/Database MissingGreenlet/i)).toBeTruthy();
        expect(screen.queryByText("No Quotations Created Yet")).toBeNull();
      });

      // Recover and click Retry
      shouldFailQuotationFetch = false;
      customQuotations = [MOCK_SAVED_QUOTATION];
      const retryBtn = screen.getByTestId("crm-quotations-retry-btn");
      fireEvent.click(retryBtn);

      // Verify quotations now load
      await waitFor(() => {
        expect(screen.queryByTestId("crm-quotations-error-container")).toBeNull();
        expect(screen.getByText("QT-202610-0001")).toBeTruthy();
      });
    });
  });
});

