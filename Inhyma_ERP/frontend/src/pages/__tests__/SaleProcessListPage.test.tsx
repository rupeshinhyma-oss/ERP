import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { SaleProcessListPage } from "../sales/SaleProcessList";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

// Mock API
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({
    data: {
      items: [],
      total: 0,
    },
  }),
  apiDelete: vi.fn(),
  errorMessage: vi.fn((err: any) => err?.message || "Error"),
}));

describe("SaleProcessListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders page title, actions, and Including GST toggle switch", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByRole("heading", { name: /sale process/i })).toBeTruthy();
    expect(screen.getByText("Including GST")).toBeTruthy();
    expect(screen.getByTestId("btn-toggle-filter")).toBeTruthy();
    expect(screen.getByRole("link", { name: /\+ add new/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /export/i })).toBeTruthy();
  });

  it("renders the 6 KPI summary stat cards matching the screenshot", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByText("ALL")).toBeTruthy();
    expect(screen.getByText("ADMIN CONFIRMED TO LR")).toBeTruthy();
    expect(screen.getByText("PENDING")).toBeTruthy();
    expect(screen.getByText("ADMIN APPROVED")).toBeTruthy();
    expect(screen.getAllByText("LR").length).toBeGreaterThan(0);
    expect(screen.getByText("CANCELLED")).toBeTruthy();
  });

  it("renders the 10 status tabs with counts", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/All \(4762\)/i)).toBeTruthy();
    expect(screen.getByText(/Pending \(2\)/i)).toBeTruthy();
    expect(screen.getByText(/Sales Confirmed \(15\)/i)).toBeTruthy();
    expect(screen.getByText(/Admin Approved \(8\)/i)).toBeTruthy();
    expect(screen.getByText(/Acc\. Confirmed \(4\)/i)).toBeTruthy();
    expect(screen.getByText(/Gatepass Created \(14\)/i)).toBeTruthy();
    expect(screen.getByText(/Dispatched \(37\)/i)).toBeTruthy();
    expect(screen.getByText(/Gatepass Cancelled \(0\)/i)).toBeTruthy();
    expect(screen.getByText(/LR \(4682\)/i)).toBeTruthy();
    expect(screen.getAllByText(/Cancelled \(0\)/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders exact table columns including Gatepass and Action", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Order No/i)).toBeTruthy();
    expect(screen.getByText(/^Warehouse$/i)).toBeTruthy();
    expect(screen.getByText(/^Exp\. Deli\. Date$/i)).toBeTruthy();
    expect(screen.getByText(/^Company$/i)).toBeTruthy();
    expect(screen.getByText(/^City \/ State$/i)).toBeTruthy();
    expect(screen.getByText(/^Third Party$/i)).toBeTruthy();
    expect(screen.getByText(/^PO$/i)).toBeTruthy();
    expect(screen.getByText(/^Sales Person$/i)).toBeTruthy();
    expect(screen.getByText(/Amount \(Inc\.GST\)/i)).toBeTruthy();
    expect(screen.getByText(/^Discount$/i)).toBeTruthy();
    expect(screen.getByText(/Status/i)).toBeTruthy();
    expect(screen.getByText(/^Acc\. Dep\.$/i)).toBeTruthy();
    expect(screen.getByText(/^Gatepass$/i)).toBeTruthy();
    expect(screen.getByText(/^Action$/i)).toBeTruthy();

    // Verify Gatepass cell displays "Pending"
    expect(screen.getAllByText("Pending").length).toBeGreaterThanOrEqual(1);
  });

  it("opens quick status update modal when clicking the 📝 edit icon on a status badge", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const editBtns = screen.getAllByTitle("Update Status");
    expect(editBtns.length).toBeGreaterThan(0);

    fireEvent.click(editBtns[0]);
    expect(screen.getByText("Update Order Status")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sales Confirmed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("renders Edit, SO Files, and Delete in action menu and opens Sales Details modal when clicking SO Files", async () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const kebabBtns = screen.getAllByRole("button", { name: "⋮" });
    expect(kebabBtns.length).toBeGreaterThan(0);

    fireEvent.click(kebabBtns[0]);
    const editBtn = screen.getByRole("button", { name: /Edit/i });
    const soFilesBtn = screen.getByRole("button", { name: /SO Files/i });
    const deleteBtn = screen.getByRole("button", { name: /Delete/i });

    expect(editBtn).toBeTruthy();
    expect(soFilesBtn).toBeTruthy();
    expect(deleteBtn).toBeTruthy();

    fireEvent.click(soFilesBtn);
    await waitFor(() => {
      expect(screen.getByText("Sales Details")).toBeTruthy();
      expect(screen.getByText("Sales Order")).toBeTruthy();
      expect(screen.getByText("Bill To")).toBeTruthy();
      expect(screen.getByText("Delivery")).toBeTruthy();
      expect(screen.getByText("Product Summary")).toBeTruthy();
      expect(screen.getByText("Terms")).toBeTruthy();
    });
  });

  it("opens Sales Details modal when clicking Individual Order No from the left side of the table", async () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    // Find and click the first Order No link (e.g. SO-MH/26-27/4041)
    const orderLink = screen.getByRole("button", { name: "SO-MH/26-27/4041" });
    expect(orderLink).toBeTruthy();

    fireEvent.click(orderLink);
    await waitFor(() => {
      expect(screen.getByText("Sales Details")).toBeTruthy();
      expect(screen.getByText("Sales Order")).toBeTruthy();
      expect(screen.getByText("INHYMA SOLUTIONS LLP (M)")).toBeTruthy();
      expect(screen.getByText("Bill To")).toBeTruthy();
      expect(screen.getByText("Delivery")).toBeTruthy();
      expect(screen.getByText("Product Summary")).toBeTruthy();
      expect(screen.getByText("Terms")).toBeTruthy();
      expect(screen.getByText(/Attached Files & Documents/i)).toBeTruthy();
      expect(screen.getByText(/Sales_Order_SO-MH_26-27_4041\.pdf/i)).toBeTruthy();
    });
  });

  it("toggles column header between Amount (Inc.GST) and Amount (Ex.GST)", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    expect(screen.getByText(/Amount \(Inc\.GST\)/i)).toBeTruthy();

    // Click toggle switch
    const switchEl = screen.getByRole("switch");
    fireEvent.click(switchEl);

    expect(screen.getByText(/Amount \(Ex\.GST\)/i)).toBeTruthy();

    // Click back
    fireEvent.click(switchEl);
    expect(screen.getByText(/Amount \(Inc\.GST\)/i)).toBeTruthy();
  });

  it("opens Account Department Timeline drawer when clicking Timeline link", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const timelineLinks = screen.getAllByRole("button", { name: "Timeline" });
    expect(timelineLinks.length).toBeGreaterThan(0);

    fireEvent.click(timelineLinks[0]);

    // Drawer should open showing timeline matching screenshot
    expect(screen.getByText(/Sale Order Time Line #/i)).toBeTruthy();
    expect(screen.getAllByText(/By : /i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Remark :/i).length).toBeGreaterThan(0);
  });

  it("toggles the collapsible filter panel when clicking the filter button", () => {
    render(
      <BrowserRouter>
        <SaleProcessListPage />
      </BrowserRouter>
    );

    const filterBtn = screen.getByTestId("btn-toggle-filter");
    expect(screen.queryByTestId("sale-process-filter-panel")).toBeNull();

    fireEvent.click(filterBtn);
    const panel = screen.getByTestId("sale-process-filter-panel");
    expect(panel).toBeTruthy();
    expect(within(panel).getByText("Order Date From")).toBeTruthy();
    expect(within(panel).getByText("Warehouse")).toBeTruthy();
    expect(within(panel).getByText("Sales Person")).toBeTruthy();

    fireEvent.click(filterBtn);
    expect(screen.queryByTestId("sale-process-filter-panel")).toBeNull();
  });
});
