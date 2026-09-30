/**
 * Comprehensive Unit & Integration Tests for FollowUpsPage.
 */

import React from "react";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import FollowUpsPage from "../FollowUpsPage";

// Mock AppShell
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, activeKey }: { children: React.ReactNode; activeKey: string }) => (
    <div data-testid="app-shell" data-active-key={activeKey}>
      {children}
    </div>
  ),
}));

// Mock API layer
vi.mock("@/lib/api", () => {
  return {
    apiGet: vi.fn((url: string) => {
      if (url.includes("/masters/states")) {
        return Promise.resolve({
          data: [
            { id: "1", name: "Gujarat" },
            { id: "2", name: "Maharashtra" },
          ],
        });
      }
      if (url.includes("/masters/districts")) {
        return Promise.resolve({
          data: [
            { id: "101", name: "Valsad" },
            { id: "102", name: "Ahmedabad" },
          ],
        });
      }
      if (url.includes("/masters/cities")) {
        return Promise.resolve({
          data: [
            { id: "1001", name: "Vapi" },
            { id: "1002", name: "Umbergaon" },
          ],
        });
      }
      if (url.includes("/follow-ups")) {
        return Promise.resolve({
          data: [
            {
              id: "fup-test-1",
              company_name: "DURAPAK (VAPI)",
              contact_person: "Ramesh Shah",
              contact_phone: "9824056789",
              contact_email: "ramesh@durapak.com",
              designation: "Plant Head",
              business_type: "Manufacturer",
              client_grade: "Grade A",
              potential_type: "High",
              business_category: "Packaging Machinery",
              category: "Industrial Equipment",
              call_type: "Outgoing Call",
              call_category: "Follow Up",
              marketing_person: "Pooja Vani",
              current_status: "Existing",
              feedback: "Quotation revised; client will confirm PO by Friday.",
              address: "Plot 42, GIDC Industrial Estate",
              area: "GIDC",
              city: "Vapi",
              district: "Valsad",
              state: "Gujarat",
              followup_date: "2026-10-05",
              added_on: "2026-09-29",
            },
            {
              id: "fup-test-2",
              company_name: "Apex Valves & Automation India Pvt Ltd",
              contact_person: "Rajesh Sharma",
              contact_phone: "9876543210",
              contact_email: "rajesh@apexvalves.com",
              designation: "Director",
              business_type: "Trader",
              client_grade: "Grade B",
              potential_type: "Medium",
              business_category: "Flow Control",
              category: "Pneumatics",
              call_type: "Incoming Call",
              call_category: "Quotation Discussion",
              marketing_person: "Admin",
              current_status: "Hot Lead",
              feedback: "Client called regarding technical specs for pneumatic control valves.",
              address: "Phase II, Vatva GIDC",
              area: "Vatva",
              city: "Ahmedabad",
              district: "Ahmedabad",
              state: "Gujarat",
              followup_date: "2026-10-02",
              added_on: "2026-09-28",
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    }),
    apiPost: vi.fn((_url: string, data: any) =>
      Promise.resolve({ success: true, data: { id: "fup-created", ...data } })
    ),
    apiPut: vi.fn((_url: string, data: any) =>
      Promise.resolve({ success: true, data: { id: "fup-updated", ...data } })
    ),
    apiDelete: vi.fn((_url: string) => Promise.resolve({ success: true })),
  };
});

describe("FollowUpsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderComponent = () =>
    render(
      <BrowserRouter>
        <FollowUpsPage />
      </BrowserRouter>
    );

  it("renders page title 'Follow Ups' and subtitle", async () => {
    renderComponent();
    expect(screen.getByRole("heading", { level: 1, name: "Follow Ups" })).toBeTruthy();
    expect(
      screen.getByText(/Telecalling interaction logs, client follow-up classifications/i)
    ).toBeTruthy();
  });

  it("renders the top action buttons: Filter toggle, + ADD NEW, and DELETE", async () => {
    renderComponent();
    expect(document.getElementById("btn-toggle-filter")).toBeTruthy();
    expect(document.getElementById("btn-add-follow-up")).toBeTruthy();
    expect(document.getElementById("btn-bulk-delete")).toBeTruthy();
  });

  it("renders all 13 table columns matching production screenshot", async () => {
    renderComponent();
    const table = document.getElementById("follow-ups-table");
    expect(table).toBeTruthy();

    const header = table?.querySelector("thead tr");
    expect(header).toBeTruthy();
    const headers = within(header as HTMLElement).getAllByRole("columnheader");
    expect(headers.length).toBe(13);

    // Column labels
    expect(within(header as HTMLElement).getByText("Sr. No.")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Company Name")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Contact Person")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Type / Grade")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Area / City")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("District / State")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Current Status")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Feedback")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Call Category")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Followup Date")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Added On")).toBeTruthy();
    expect(within(header as HTMLElement).getByText("Action")).toBeTruthy();
  });

  it("renders loaded items in the table", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
      expect(screen.getByText("Apex Valves & Automation India Pvt Ltd")).toBeTruthy();
    });
  });

  it("renders the 12-control Filter Card matching production 4x3 grid when toggled", async () => {
    renderComponent();
    // Initially off (collapsed)
    expect(document.getElementById("filter-call-type")).toBeNull();

    // Toggle on
    fireEvent.click(document.getElementById("btn-toggle-filter")!);

    expect(document.getElementById("filter-added-date")).toBeTruthy();
    expect(document.getElementById("filter-call-type")).toBeTruthy();
    expect(document.getElementById("filter-marketing-person")).toBeTruthy();
    expect(document.getElementById("filter-business-type")).toBeTruthy();
    expect(document.getElementById("filter-state")).toBeTruthy();
    expect(document.getElementById("filter-district")).toBeTruthy();
    expect(document.getElementById("filter-city")).toBeTruthy();
    expect(document.getElementById("filter-current-status")).toBeTruthy();
    expect(document.getElementById("filter-category")).toBeTruthy();
    expect(document.getElementById("filter-client-grade")).toBeTruthy();
    expect(document.getElementById("filter-potential-type")).toBeTruthy();
    expect(document.getElementById("filter-business-category")).toBeTruthy();

    expect(document.getElementById("btn-reset-filters")).toBeTruthy();
    expect(document.getElementById("btn-search-filters")).toBeTruthy();
  });

  it("toggles the filter card when clicking the filter toggle button", async () => {
    renderComponent();
    const toggleBtn = document.getElementById("btn-toggle-filter")!;
    // Starts off (collapsed)
    expect(document.getElementById("filter-call-type")).toBeNull();

    // Click 1: turns on
    fireEvent.click(toggleBtn);
    expect(document.getElementById("filter-call-type")).toBeTruthy();

    // Click 2: turns off
    fireEvent.click(toggleBtn);
    expect(document.getElementById("filter-call-type")).toBeNull();
  });

  it("supports free text search filtering", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
    });

    const searchInput = document.getElementById("table-search-input")!;
    fireEvent.change(searchInput, { target: { value: "Apex" } });

    await waitFor(() => {
      expect(screen.queryByText("DURAPAK (VAPI)")).toBeNull();
      expect(screen.getByText("Apex Valves & Automation India Pvt Ltd")).toBeTruthy();
    });
  });

  it("supports 3-state column sorting", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
    });

    const companyHeader = screen.getByText("Company Name");
    // 1. Ascending
    fireEvent.click(companyHeader);
    expect(screen.getByText("▲")).toBeTruthy();

    // 2. Descending
    fireEvent.click(companyHeader);
    expect(screen.getByText("▼")).toBeTruthy();

    // 3. Reset
    fireEvent.click(companyHeader);
    expect(screen.queryByText("▲")).toBeNull();
    expect(screen.queryByText("▼")).toBeNull();
  });

  it("opens SideDrawer profile inspection when clicking Company Name", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
    });

    const companyBtn = screen.getByRole("button", { name: "DURAPAK (VAPI)" });
    fireEvent.click(companyBtn);

    await waitFor(() => {
      expect(screen.getByText("Follow Up Interaction Profile")).toBeTruthy();
      expect(screen.getByText("Feedback & Discussion Notes")).toBeTruthy();
      expect(screen.getByText("Interaction Details")).toBeTruthy();
      expect(screen.getAllByText(/Quotation revised; client will confirm PO by Friday/i).length).toBe(2);
    });
  });

  it("opens Add Call Log drawer when clicking + ADD NEW with exact screenshot fields", async () => {
    renderComponent();
    const addBtn = document.getElementById("btn-add-follow-up")!;
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Add Call Log" })).toBeTruthy();
    });

    // Check exact fields from screenshot
    expect(document.getElementById("call-log-call-type")).toBeTruthy();
    expect(document.getElementById("call-log-company-name")).toBeTruthy();
    expect(document.getElementById("call-log-contact-person")).toBeTruthy();
    expect(document.getElementById("call-log-phone-number")).toBeTruthy();
    expect(document.getElementById("call-log-feedback")).toBeTruthy();
    expect(document.getElementById("call-log-followup-date")).toBeTruthy();
    expect(document.getElementById("call-log-status")).toBeTruthy();
    expect(document.getElementById("btn-submit-followup")).toBeTruthy();

    // Default values matching screenshot
    const callTypeSelect = document.getElementById("call-log-call-type") as HTMLSelectElement;
    expect(callTypeSelect.value).toBe("Telecall");

    const statusSelect = document.getElementById("call-log-status") as HTMLSelectElement;
    expect(statusSelect.value).toBe("Active");
  });

  it("submits a new call log successfully", async () => {
    renderComponent();
    fireEvent.click(document.getElementById("btn-add-follow-up")!);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Add Call Log" })).toBeTruthy();
    });

    const companyInput = document.getElementById("call-log-company-name") as HTMLInputElement;
    fireEvent.change(companyInput, { target: { value: "New Acme Tech" } });

    const contactInput = document.getElementById("call-log-contact-person") as HTMLInputElement;
    fireEvent.change(contactInput, { target: { value: "Anil Patel" } });

    const phoneInput = document.getElementById("call-log-phone-number") as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "9898012345" } });

    const feedbackTextarea = document.getElementById("call-log-feedback") as HTMLTextAreaElement;
    fireEvent.change(feedbackTextarea, { target: { value: "Requested formal proforma invoice." } });

    const submitBtn = document.getElementById("btn-submit-followup")!;
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 2, name: "Add Call Log" })).toBeNull();
      expect(screen.getByText("New Acme Tech")).toBeTruthy();
    });
  });

  it("supports row selection and bulk delete", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
    });

    // Bulk delete button disabled initially
    const bulkDeleteBtn = document.getElementById("btn-bulk-delete") as HTMLButtonElement;
    expect(bulkDeleteBtn.disabled).toBe(true);

    // Select all
    const selectAllCheckbox = document.getElementById("select-all-checkbox") as HTMLInputElement;
    fireEvent.click(selectAllCheckbox);

    // Bulk delete button enabled
    expect(bulkDeleteBtn.disabled).toBe(false);
    expect(bulkDeleteBtn.textContent).toContain("DELETE (2)");

    // Click bulk delete
    fireEvent.click(bulkDeleteBtn);
    expect(screen.getByRole("heading", { level: 3, name: "Confirm Deletion" })).toBeTruthy();

    const confirmBtn = document.getElementById("btn-confirm-delete")!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText("No Data Available In Table")).toBeTruthy();
    });
  });
});
