import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { DeletedOrdersPage, INITIAL_DELETED_ORDERS } from "../DeletedOrdersPage";
import { DeletedOrdersApi } from "@/lib/api";
import * as salesPdfModule from "@/lib/salesOrderPdf";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock sales order PDF generator
vi.spyOn(salesPdfModule, "generateSalesOrderPdf").mockReturnValue({} as any);

describe("DeletedOrdersPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(DeletedOrdersApi, "listDeletedOrders").mockResolvedValue({
      data: { items: INITIAL_DELETED_ORDERS },
    } as any);
  });

  const renderComponent = async () => {
    const rendered = render(
      <BrowserRouter>
        <DeletedOrdersPage />
      </BrowserRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText(/Loading deleted orders records/i)).toBeNull();
    });
    return rendered;
  };

  it("renders page title and active navigation key", async () => {
    await renderComponent();

    expect(screen.getByRole("heading", { level: 1, name: "Deleted Orders" })).toBeTruthy();
    expect(screen.getByTestId("app-shell").getAttribute("data-active-key")).toBe("reports-deleted-orders");
  });

  it("renders the 13 table headers matching screenshot", async () => {
    await renderComponent();

    expect(screen.getByText("Order No *")).toBeTruthy();
    expect(screen.getAllByText("Warehouse").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Exp. Deli. Date")).toBeTruthy();
    expect(screen.getByText("Company")).toBeTruthy();
    expect(screen.getByText("City / State")).toBeTruthy();
    expect(screen.getByText("Third Party")).toBeTruthy();
    expect(screen.getByText("PO")).toBeTruthy();
    expect(screen.getAllByText("Sales Person").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Amount (Inc.GST) *")).toBeTruthy();
    expect(screen.getByText("Discount")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Acc. Dep.")).toBeTruthy();
    expect(screen.getByText("Gatepass")).toBeTruthy();
  });

  it("renders seed deleted orders items", async () => {
    await renderComponent();

    expect(screen.getByText("SO-MP/26-27/0618")).toBeTruthy();
    expect(screen.getByText("SMART PACKAGING SYSTEMS")).toBeTruthy();
    expect(screen.getByText("SHANTI PACKAGING")).toBeTruthy();
    expect(screen.getByText("SO-MH/26-27/4401")).toBeTruthy();
    expect(screen.getByText("DHUMER AUTOMATION & SERVICES")).toBeTruthy();
  });

  it("filters orders by search term", async () => {
    await renderComponent();

    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.change(searchInput, { target: { value: "SMART PACKAGING" } });

    await waitFor(() => {
      expect(screen.getByText("SMART PACKAGING SYSTEMS")).toBeTruthy();
      expect(screen.queryByText("SHANTI PACKAGING")).toBeNull();
    });
  });

  it("filters orders by warehouse dropdown", async () => {
    await renderComponent();

    const warehouseSelect = screen.getByLabelText("Warehouse");
    fireEvent.change(warehouseSelect, { target: { value: "Indore" } });

    const searchBtn = screen.getByRole("button", { name: /Search/i });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Loading deleted orders records/i)).toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText("SO-MP/26-27/0618")).toBeTruthy();
      expect(screen.queryByText("SO-MH/26-27/4476")).toBeNull();
    });
  });

  it("triggers PDF generation when clicking Order No link", async () => {
    await renderComponent();

    const orderLink = screen.getByText("SO-MP/26-27/0618");
    fireEvent.click(orderLink);

    expect(salesPdfModule.generateSalesOrderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        order_no: "SO-MP/26-27/0618",
        warehouse: "Indore",
      }),
      { openInNewTab: true }
    );
  });

  it("opens order timeline drawer on clicking Timeline button", async () => {
    await renderComponent();

    const timelineButtons = screen.getAllByRole("button", { name: "Timeline" });
    fireEvent.click(timelineButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Order Timeline: SO-MP\/26-27\/0618/i)).toBeTruthy();
      expect(screen.getByText(/Order Moved To Trash/i)).toBeTruthy();
      expect(screen.getByText(/Sales Order Created/i)).toBeTruthy();
    });
  });

  it("opens account info modal on clicking 'i' button", async () => {
    await renderComponent();

    const infoButtons = screen.getAllByTitle("Account Department Status Information");
    fireEvent.click(infoButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Account Department Details")).toBeTruthy();
      expect(screen.getByText("Accounting Status:")).toBeTruthy();
    });
  });

  it("restores order when clicking Restore Order button in timeline drawer", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(DeletedOrdersApi, "restoreDeletedOrder").mockResolvedValue({
      data: { id: "del-1", restored: true },
    } as any);

    await renderComponent();

    // Open timeline for first order
    const timelineButtons = screen.getAllByRole("button", { name: "Timeline" });
    fireEvent.click(timelineButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Restore Order/i })).toBeTruthy();
    });

    // Click Restore Order
    fireEvent.click(screen.getByRole("button", { name: /Restore Order/i }));

    await waitFor(() => {
      expect(DeletedOrdersApi.restoreDeletedOrder).toHaveBeenCalledWith("del-1");
      // del-1 order number should no longer be in list
      expect(screen.queryByText("SO-MP/26-27/0618")).toBeNull();
    });
  });
});

