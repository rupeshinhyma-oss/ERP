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
              call_category: "Followup",
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
              direct_import_from_china: "Yes",
              monthly_import_volume: "10 Containers",
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
              call_category: "Lead",
              lead_status: "Won",
              reason_for_won_loss: "Best pricing & specs",
              direct_import_from_china: "No",
              monthly_import_volume: "2 Containers",
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
    apiPost: vi.fn((url: string, data: any) => {
      if (url.includes("/companies")) {
        return Promise.resolve({ success: true, data: { id: "comp-created-1", ...data } });
      }
      return Promise.resolve({ success: true, data: { id: "fup-created", ...data } });
    }),
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

  it("renders the 15-control Filter Card including Call Category, Direct Import, and Volume when toggled", async () => {
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
    // New Section 2.5 Filters
    expect(document.getElementById("filter-call-category")).toBeTruthy();
    expect(document.getElementById("filter-direct-import")).toBeTruthy();
    expect(document.getElementById("filter-monthly-import-volume")).toBeTruthy();

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

  it("enforces edit removal: only view and delete options given, and feedback column has eye icon", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
    });

    // Check no edit buttons exist in table
    expect(screen.queryByTitle("Edit Follow Up")).toBeNull();

    // Check View and Delete buttons exist in row
    const viewButtons = screen.getAllByTestId("btn-view-follow-up");
    const deleteButtons = screen.getAllByTestId("btn-delete-follow-up");
    expect(viewButtons.length).toBe(2);
    expect(deleteButtons.length).toBe(2);

    // Clicking View button opens inspection SideDrawer
    fireEvent.click(viewButtons[0]);
    await waitFor(() => {
      expect(screen.getByText("Follow Up Interaction Profile")).toBeTruthy();
      // Ensure no edit button in SideDrawer
      expect(screen.queryByText(/Edit Log/i)).toBeNull();
    });

    // Close side drawer by clicking close
    const closeBtn = (document.querySelector(".modal-close") || screen.getByRole("button", { name: "×" })) as HTMLElement;
    fireEvent.click(closeBtn);

    // Check Eye icon in Feedback column opens SideDrawer
    const feedbackEyeButtons = screen.getAllByTestId("btn-feedback-eye");
    expect(feedbackEyeButtons.length).toBe(2);
    fireEvent.click(feedbackEyeButtons[0]);
    await waitFor(() => {
      expect(screen.getByText("Feedback & Discussion Notes")).toBeTruthy();
    });
  });

  it("opens Quick Add Company Form 1 and auto-populates Call Log form", async () => {
    renderComponent();
    const addBtn = document.getElementById("btn-add-follow-up")!;
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Add Call Log" })).toBeTruthy();
    });

    // Check + Add Company button exists
    const quickAddBtn = document.getElementById("btn-quick-add-company")!;
    expect(quickAddBtn).toBeTruthy();
    fireEvent.click(quickAddBtn);

    // Form 1 modal opens
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: /Add Company \(Form 1 - Prospect Master\)/i })).toBeTruthy();
    });

    // Enter GST and click Fetch Data
    const gstInput = document.getElementById("form1_tax_id_number") as HTMLInputElement;
    fireEvent.change(gstInput, { target: { value: "24ABCDE1234F1Z5" } });
    const fetchGstBtn = document.getElementById("btn-form1-fetch-gst")!;
    fireEvent.click(fetchGstBtn);

    await waitFor(() => {
      expect(screen.getByText(/State auto-detected from GST: Gujarat/i)).toBeTruthy();
    });

    // Fill Company Name, Contact Person, Calling Number, Designation
    fireEvent.change(document.getElementById("form1_company_name")!, { target: { value: "Alpha Global Polymers" } });
    fireEvent.change(document.getElementById("form1_contact_name")!, { target: { value: "Suresh Gupta" } });
    fireEvent.change(document.getElementById("form1_contact_calling_number")!, { target: { value: "9825123456" } });
    fireEvent.change(document.getElementById("form1_contact_designation")!, { target: { value: "Procurement Head" } });

    // Click Copy Primary for WhatsApp
    fireEvent.click(document.getElementById("btn-form1-copy-primary")!);
    const whatsappInput = document.getElementById("form1_contact_whatsapp_number") as HTMLInputElement;
    expect(whatsappInput.value).toBe("9825123456");

    // Save Form 1
    const saveCompanyBtn = document.getElementById("btn-form1-save-company")!;
    fireEvent.click(saveCompanyBtn);

    // Form 1 closes and Call Log form is auto-populated
    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 3, name: /Add Company \(Form 1 - Prospect Master\)/i })).toBeNull();
      const compInput = document.getElementById("call-log-company-name") as HTMLInputElement;
      expect(compInput.value).toBe("Alpha Global Polymers");
      const personInput = document.getElementById("call-log-contact-person") as HTMLInputElement;
      expect(personInput.value).toBe("Suresh Gupta");
      const phoneInput = document.getElementById("call-log-phone-number") as HTMLInputElement;
      expect(phoneInput.value).toBe("9825123456");
      const desigInput = document.getElementById("call-log-designation") as HTMLInputElement;
      expect(desigInput.value).toBe("Procurement Head");
    });
  });

  it("captures Lead fields conditionally when Call Category is Lead", async () => {
    renderComponent();
    fireEvent.click(document.getElementById("btn-add-follow-up")!);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Add Call Log" })).toBeTruthy();
    });

    const categorySelect = document.getElementById("call-log-call-category") as HTMLSelectElement;
    expect(categorySelect.value).toBe("Followup");

    // Lead fields are initially not present
    expect(document.getElementById("call-log-lead-status")).toBeNull();
    expect(document.getElementById("call-log-won-loss-reason")).toBeNull();

    // Select "Lead"
    fireEvent.change(categorySelect, { target: { value: "Lead" } });

    // Now Lead fields are displayed
    expect(document.getElementById("call-log-lead-status")).toBeTruthy();
    expect(document.getElementById("call-log-won-loss-reason")).toBeTruthy();

    const leadStatusSelect = document.getElementById("call-log-lead-status") as HTMLSelectElement;
    expect(leadStatusSelect.value).toBe("Ongoing");
    fireEvent.change(leadStatusSelect, { target: { value: "Won" } });

    const reasonInput = document.getElementById("call-log-won-loss-reason") as HTMLTextAreaElement;
    fireEvent.change(reasonInput, { target: { value: "Price matched target budget" } });

    // Also fill Direct Import and Monthly Import Volume
    const directImportSelect = document.getElementById("call-log-direct-import") as HTMLSelectElement;
    fireEvent.change(directImportSelect, { target: { value: "Yes" } });

    const monthlyVolInput = document.getElementById("call-log-monthly-import-volume") as HTMLInputElement;
    fireEvent.change(monthlyVolInput, { target: { value: "8 Containers" } });

    // Fill Company name and submit
    fireEvent.change(document.getElementById("call-log-company-name")!, { target: { value: "Beta Plastics Ltd" } });
    fireEvent.click(document.getElementById("btn-submit-followup")!);

    await waitFor(() => {
      expect(screen.getByText("Beta Plastics Ltd")).toBeTruthy();
    });
  });

  it("filters follow-up logs by Call Category, Direct Import, and Monthly Import Volume", async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
      expect(screen.getByText("Apex Valves & Automation India Pvt Ltd")).toBeTruthy();
    });

    // Open filter panel
    fireEvent.click(document.getElementById("btn-toggle-filter")!);

    // Filter by Call Category = "Lead"
    const catFilter = document.getElementById("filter-call-category") as HTMLSelectElement;
    fireEvent.change(catFilter, { target: { value: "Lead" } });
    fireEvent.click(document.getElementById("btn-search-filters")!);

    await waitFor(() => {
      expect(screen.queryByText("DURAPAK (VAPI)")).toBeNull();
      expect(screen.getByText("Apex Valves & Automation India Pvt Ltd")).toBeTruthy();
    });

    // Reset filters
    fireEvent.click(document.getElementById("btn-reset-filters")!);
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
      expect(screen.getByText("Apex Valves & Automation India Pvt Ltd")).toBeTruthy();
    });

    // Filter by Direct Import from China = "Yes"
    const importFilter = document.getElementById("filter-direct-import") as HTMLSelectElement;
    fireEvent.change(importFilter, { target: { value: "Yes" } });
    fireEvent.click(document.getElementById("btn-search-filters")!);

    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
      expect(screen.queryByText("Apex Valves & Automation India Pvt Ltd")).toBeNull();
    });

    // Reset filters
    fireEvent.click(document.getElementById("btn-reset-filters")!);
    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
      expect(screen.getByText("Apex Valves & Automation India Pvt Ltd")).toBeTruthy();
    });

    // Filter by Monthly Import Volume = "10 Containers"
    const volFilter = document.getElementById("filter-monthly-import-volume") as HTMLInputElement;
    fireEvent.change(volFilter, { target: { value: "10 Containers" } });
    fireEvent.click(document.getElementById("btn-search-filters")!);

    await waitFor(() => {
      expect(screen.getByText("DURAPAK (VAPI)")).toBeTruthy();
      expect(screen.queryByText("Apex Valves & Automation India Pvt Ltd")).toBeNull();
    });
  });
});
