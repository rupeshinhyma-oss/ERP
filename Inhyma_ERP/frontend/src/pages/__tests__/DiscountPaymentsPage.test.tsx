import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscountPaymentsPage } from "../sales/DiscountPaymentsPage";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null }),
  apiPatch: vi.fn().mockResolvedValue({ data: { success: true } }),
  errorMessage: vi.fn((err) => String(err)),
}));

// Mock toast
vi.mock("@/lib/toast", () => ({
  useToast: () => vi.fn(),
}));

describe("DiscountPaymentsPage (/sale-discount/list & /discount-payments/list)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page title, filter toggle button, and breadcrumb", () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: /Discount Payments/i })).toBeTruthy();
    expect(screen.getByTestId("btn-toggle-filter")).toBeTruthy();
    expect(screen.getByText("SALE")).toBeTruthy();
    expect(screen.getAllByText("Discount Payments").length).toBeGreaterThan(0);
  });

  it("renders the 3 KPI summary stat cards matching the screenshot", () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    expect(screen.getByText("TOTAL DISCOUNT")).toBeTruthy();
    expect(screen.getByText("₹ 8,06,895.00")).toBeTruthy();

    expect(screen.getByText("PAID")).toBeTruthy();
    expect(screen.getByText("₹ 7,65,225.00")).toBeTruthy();

    expect(screen.getByText("DUE")).toBeTruthy();
    expect(screen.getByText("₹ 41,670.00")).toBeTruthy();
  });

  it("renders Pending and Completed tabs and switches between them", () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    const pendingTab = screen.getByRole("button", { name: /Pending/i });
    const completedTab = screen.getByRole("button", { name: /Completed/i });

    expect(pendingTab).toBeTruthy();
    expect(completedTab).toBeTruthy();

    // Default Pending shows Garuda Engineers
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();

    // Switch to Completed tab
    fireEvent.click(completedTab);
    expect(screen.getByText("SHREE GANESH ENTERPRISES")).toBeTruthy();
    expect(screen.queryByText("GARUDA ENGINEERS")).toBeNull();

    // Switch back to Pending
    fireEvent.click(pendingTab);
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
  });

  it("renders exact table columns including Gatepass and Action", () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("columnheader", { name: "Order No" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Warehouse" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Company" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Contact Person" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Sales Person" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Total Discount" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Paid/Due Dis. Amount" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Gatepass" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
  });

  it("renders sample rows from the production screenshot with Due amount and Status badge", () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    // Row 1: SO-MH/26-27/3826
    expect(screen.getByText("SO-MH/26-27/3826")).toBeTruthy();
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
    expect(screen.getByText("Jalpesh")).toBeTruthy();
    expect(screen.getByText("9427419237")).toBeTruthy();
    expect(screen.getAllByText("Abhishek Patel").length).toBeGreaterThan(0);
    expect(screen.getByText("₹ 35,000.00")).toBeTruthy();
    expect(screen.getByText("Due ₹ 35,000.00")).toBeTruthy();
    expect(screen.getByText("ID: 4539")).toBeTruthy();

    // Row 4: GLOBAL IMPEX with Paid 54,000 and Due 2,000
    expect(screen.getByText("GLOBAL IMPEX MACHINERY")).toBeTruthy();
    expect(screen.getByText("Paid 54,000.00")).toBeTruthy();
    expect(screen.getByText("Due ₹ 2,000.00")).toBeTruthy();
  });

  it("opens Remark modal when clicking the red Remark link", async () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    const remarkBtns = screen.getAllByRole("button", { name: "Remark" });
    expect(remarkBtns.length).toBeGreaterThan(0);

    fireEvent.click(remarkBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Discount Remarks — SO-MH\/26-27\/3826/i)).toBeTruthy();
      expect(screen.getByText(/Volume rebate authorized by management/i)).toBeTruthy();
    });

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Discount Remarks — SO-MH\/26-27\/3826/i)).toBeNull();
    });
  });

  it("keeps filter panel off by default, and toggles open on filter button click", () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    // By default ("Keep it off"), the filter panel is closed
    expect(screen.queryByTestId("discount-filter-panel")).toBeNull();

    const filterBtn = screen.getByTestId("btn-toggle-filter");
    // Click toggle button to open
    fireEvent.click(filterBtn);
    expect(screen.getByTestId("discount-filter-panel")).toBeTruthy();
    expect(screen.getByLabelText("Warehouse")).toBeTruthy();
    expect(screen.getByLabelText("Sales Person")).toBeTruthy();
    expect(screen.getByLabelText("Dispatch")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();

    // Click toggle button again to close
    fireEvent.click(filterBtn);
    expect(screen.queryByTestId("discount-filter-panel")).toBeNull();
  });

  it("filters orders by Warehouse and resets filters correctly", () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    // Initial state: Mumbai and Ahmedabad orders both visible
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy(); // Mumbai
    expect(screen.getByText("GLOBAL IMPEX MACHINERY")).toBeTruthy(); // Ahmedabad

    // Open filter panel
    fireEvent.click(screen.getByTestId("btn-toggle-filter"));

    // Select Warehouse: Ahmedabad
    const warehouseSelect = screen.getByLabelText("Warehouse");
    fireEvent.change(warehouseSelect, { target: { value: "Ahmedabad" } });

    // Click Search to apply filter
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // Now only Ahmedabad orders should be displayed
    expect(screen.getByText("GLOBAL IMPEX MACHINERY")).toBeTruthy();
    expect(screen.getByText("EM PACKAGING")).toBeTruthy();
    expect(screen.queryByText("GARUDA ENGINEERS")).toBeNull();

    // Click Reset to clear filter
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    // Both should be restored
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
    expect(screen.getByText("GLOBAL IMPEX MACHINERY")).toBeTruthy();
  });

  it("filters orders by Sales Person and Dispatch", () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    // Open filter panel
    fireEvent.click(screen.getByTestId("btn-toggle-filter"));

    // Select Sales Person: Abhishek Patel
    const salesPersonSelect = screen.getByLabelText("Sales Person");
    fireEvent.change(salesPersonSelect, { target: { value: "Abhishek Patel" } });

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // Only Abhishek Patel's orders should show
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
    expect(screen.queryByText("GLOBAL IMPEX MACHINERY")).toBeNull();

    // Select Dispatch: LR
    const dispatchSelect = screen.getByLabelText("Dispatch");
    fireEvent.change(dispatchSelect, { target: { value: "LR" } });

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("GARUDA ENGINEERS")).toBeTruthy();
  });

  it("opens Adjust Discount right-side drawer from Action menu, displays summary & fields, and submits adjustment", async () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    const kebabBtns = screen.getAllByRole("button", { name: "⋮" });
    expect(kebabBtns.length).toBeGreaterThan(0);

    fireEvent.click(kebabBtns[0]);

    const adjustBtn = screen.getByRole("button", { name: /Adjust Discount/i });
    expect(adjustBtn).toBeTruthy();

    fireEvent.click(adjustBtn);

    await waitFor(() => {
      expect(screen.getByTestId("discount-adjustment-drawer")).toBeTruthy();
      expect(screen.getByText("Discount Adjustment")).toBeTruthy();
      expect(screen.getByText("Discount Summary")).toBeTruthy();
      expect(screen.getByText("Total Discount:")).toBeTruthy();
      expect(screen.getByText("Total Discount Paid:")).toBeTruthy();
      expect(screen.getByText("Total Discount Due:")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
    });

    // Verify fields
    const dateInput = screen.getByLabelText("Date");
    expect((dateInput as HTMLInputElement).value).toBe("22-09-2026");

    // Click Date input to open the interactive calendar dropdown
    fireEvent.click(dateInput);
    const dateDropdown = screen.getByTestId("datepicker-dropdown");
    expect(dateDropdown).toBeTruthy();
    expect(screen.getByText(/SEPTEMBER 2026/i)).toBeTruthy();
    expect(screen.getByText("SU")).toBeTruthy();
    expect(screen.getByText("MO")).toBeTruthy();

    // Select day 25 from calendar
    const day25Btn = screen.getByRole("button", { name: "25" });
    fireEvent.click(day25Btn);
    expect((dateInput as HTMLInputElement).value).toBe("25-09-2026");

    const amountInput = screen.getByPlaceholderText("Max: 35000");
    expect(amountInput).toBeTruthy();

    const remarksTextarea = screen.getByLabelText("Remarks/Feedback");
    expect(remarksTextarea).toBeTruthy();

    // Test typing amount & remarks
    fireEvent.change(amountInput, { target: { value: "15000" } });
    fireEvent.change(remarksTextarea, { target: { value: "Partial adjustment verified" } });

    // Click Submit
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.queryByTestId("discount-adjustment-drawer")).toBeNull();
    });
  });

  it("closes Adjust Discount drawer on close button click and Escape key", async () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    const kebabBtns = screen.getAllByRole("button", { name: "⋮" });
    fireEvent.click(kebabBtns[0]);
    fireEvent.click(screen.getByRole("button", { name: /Adjust Discount/i }));

    await waitFor(() => {
      expect(screen.getByTestId("discount-adjustment-drawer")).toBeTruthy();
    });

    // Close via Close button (✕)
    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("discount-adjustment-drawer")).toBeNull();
    });

    // Reopen and close via Escape key
    fireEvent.click(kebabBtns[0]);
    fireEvent.click(screen.getByRole("button", { name: /Adjust Discount/i }));

    await waitFor(() => {
      expect(screen.getByTestId("discount-adjustment-drawer")).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("discount-adjustment-drawer")).toBeNull();
    });
  });

  it("opens List Payments modal matching screenshot with Sale Order Detail card and payments table", async () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    const kebabBtns = screen.getAllByRole("button", { name: "⋮" });

    // Test Row 1: GARUDA ENGINEERS (paid_discount === 0)
    fireEvent.click(kebabBtns[0]);
    const listPaymentsBtn = screen.getByRole("button", { name: /List Payments/i });
    expect(listPaymentsBtn).toBeTruthy();

    fireEvent.click(listPaymentsBtn);

    await waitFor(() => {
      const modal = screen.getByTestId("list-payments-modal");
      expect(modal).toBeTruthy();
      expect(within(modal).getByText("Discount Adjustment Payment List")).toBeTruthy();
      expect(within(modal).getByText("Sale Order Detail")).toBeTruthy();
      expect(within(modal).getByText("#5125")).toBeTruthy();
      expect(within(modal).getByText("Customer Name")).toBeTruthy();
      expect(within(modal).getByText("Jalpesh")).toBeTruthy();
      expect(within(modal).getByText("Created Date")).toBeTruthy();
      expect(within(modal).getByText("12-09-2026 11:26 AM")).toBeTruthy();
      expect(within(modal).getByText("Total Discount")).toBeTruthy();
      expect(within(modal).getByText("Paid Amount")).toBeTruthy();
      expect(within(modal).getByText("Due Amount")).toBeTruthy();
      expect(within(modal).getByText("Adjustment By")).toBeTruthy();
      expect(within(modal).getByText("No Payment Found")).toBeTruthy();
    });

    // Close via Close button (✕)
    const modal = screen.getByTestId("list-payments-modal");
    const closeBtn = within(modal).getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("list-payments-modal")).toBeNull();
    });

    // Test Row 4: GLOBAL IMPEX MACHINERY (paid_discount === 54,000)
    fireEvent.click(kebabBtns[3]);
    fireEvent.click(screen.getByRole("button", { name: /List Payments/i }));

    await waitFor(() => {
      const modal4 = screen.getByTestId("list-payments-modal");
      expect(modal4).toBeTruthy();
      expect(within(modal4).getAllByText("₹ 54,000.00").length).toBeGreaterThan(0);
      expect(within(modal4).getByText("Dhairya Shah")).toBeTruthy();
      expect(within(modal4).getByText("Discount Adjustment")).toBeTruthy();
    });

    // Close via Escape key
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("list-payments-modal")).toBeNull();
    });
  });

  it("opens Sales Order PDF in a new tab when clicking Order No", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    const orderLink = screen.getByRole("link", { name: "SO-MH/26-27/3826" });
    expect(orderLink).toBeTruthy();
    expect(orderLink.getAttribute("href")).toContain("/sale-order/invoice/so-3826");

    fireEvent.click(orderLink);
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("/sale-order/invoice/so-3826"),
      "_blank"
    );
    openSpy.mockRestore();
  });

  it("opens Company Detail modal when clicking Company name or Contact name", async () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    const companyBtn = screen.getByRole("button", { name: "GARUDA ENGINEERS" });
    expect(companyBtn).toBeTruthy();

    fireEvent.click(companyBtn);

    await waitFor(() => {
      const modal = screen.getByTestId("company-detail-modal");
      const m = within(modal);
      expect(m.getByText("Company Detail #601")).toBeTruthy();
      expect(m.getByText("Company Name")).toBeTruthy();
      expect(m.getByText("GARUDA ENGINEERS")).toBeTruthy();
      expect(m.getByText("Full Name / Designation")).toBeTruthy();
      expect(m.getByText("Mr Jalpesh")).toBeTruthy();
      expect(m.getByText("Owner")).toBeTruthy();
      expect(m.getByText("GST No")).toBeTruthy();
      expect(m.getByText("24ALCPG8895N1ZG")).toBeTruthy();
      expect(m.getByText("9427419237")).toBeTruthy();
      expect(
        m.getByText(
          "C-15,MARUTI ESTATE, NR KIRAN INDUSTRIES, BOMBAY CONDUCTOR ROAD, GIDC VATVA, GIDC VATVA"
        )
      ).toBeTruthy();
      expect(m.getByText("City")).toBeTruthy();
      expect(m.getByText("District")).toBeTruthy();
      expect(m.getByText("State")).toBeTruthy();
      expect(m.getAllByText("Ahmedabad").length).toBe(2);
      expect(m.getByText("Maharashtra")).toBeTruthy();
      expect(m.getByText("Current Status")).toBeTruthy();
      expect(m.getByText("Existing")).toBeTruthy();
      expect(m.getByText("Bussiness Type")).toBeTruthy();
      expect(m.getByText("B2B")).toBeTruthy();
      expect(m.getByText("Category")).toBeTruthy();
      expect(m.getByText("Traditional")).toBeTruthy();
      expect(m.getByText("Potential Type")).toBeTruthy();
      expect(m.getByText("Yes")).toBeTruthy();
      expect(m.getByText("Business Categories")).toBeTruthy();
      expect(m.getByText("Manufacturer")).toBeTruthy();
      expect(m.getByText("Machines Currently Buying From")).toBeTruthy();
      expect(m.getByText("Arjun")).toBeTruthy();
      expect(m.getByText("Products Interested To Buy From Us")).toBeTruthy();
      expect(m.getByText("Flow Wrap")).toBeTruthy();
      expect(m.getByText("Sales Person")).toBeTruthy();
      expect(m.getByText("Abhishek Patel")).toBeTruthy();
    });

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText("Company Detail #601")).toBeNull();
    });

    // Also test clicking contact name opens Company Detail modal
    const contactBtn = screen.getByRole("button", { name: "Mr Jalpesh" });
    fireEvent.click(contactBtn);

    await waitFor(() => {
      expect(screen.getByText("Company Detail #601")).toBeTruthy();
    });

    const closeBtn2 = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn2);

    await waitFor(() => {
      expect(screen.queryByText("Company Detail #601")).toBeNull();
    });
  });

  it("opens Gate Pass Detail drawer when clicking Gatepass ID or Date", async () => {
    render(
      <BrowserRouter>
        <DiscountPaymentsPage />
      </BrowserRouter>
    );

    const gatepassBtn = screen.getByRole("button", { name: "ID: 4539" });
    expect(gatepassBtn).toBeTruthy();

    fireEvent.click(gatepassBtn);

    await waitFor(() => {
      const drawer = screen.getByTestId("gatepass-detail-drawer");
      const d = within(drawer);
      expect(d.getByText("Gate Pass Detail #4539")).toBeTruthy();
      expect(d.getByText("Sale Order No")).toBeTruthy();
      expect(d.getByText("SO-MH/26-27/3826")).toBeTruthy();
      expect(d.getByText("Date")).toBeTruthy();
      expect(d.getByText("12-09-2026")).toBeTruthy();
      expect(d.getByText("Gate Keeper Name")).toBeTruthy();
      expect(d.getByText("Sushant Dhawade")).toBeTruthy();
      expect(d.getByText("Transport Name")).toBeTruthy();
      expect(d.getByText("Delhivery Limited")).toBeTruthy();
      expect(d.getByText("Delivery Type")).toBeTruthy();
      expect(d.getByText("Godown")).toBeTruthy();
      expect(d.getByText("Delivery Charge")).toBeTruthy();
      expect(d.getByText("To Pay")).toBeTruthy();
      expect(d.getByText("LR File")).toBeTruthy();
      expect(d.getByText("LR File :")).toBeTruthy();
    });

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText("Gate Pass Detail #4539")).toBeNull();
    });

    // Also test clicking the gatepass date opens the drawer
    const dateBtn = screen.getByRole("button", { name: "12-09-2026" });
    fireEvent.click(dateBtn);

    await waitFor(() => {
      expect(screen.getByText("Gate Pass Detail #4539")).toBeTruthy();
    });

    const closeBtn2 = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn2);

    await waitFor(() => {
      expect(screen.queryByText("Gate Pass Detail #4539")).toBeNull();
    });
  });
});
