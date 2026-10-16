import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TechnicalCallLogsPage } from "./TechnicalCallLogsPage";
import * as api from "@/lib/technicalTasksApi";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [] }),
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isAbortError: () => false,
}));

const row = {
  id: "log-1", task_id: "t-1", call_date: "2026-10-14", call_type: "Telecall", remarks: "Customer asked to call tomorrow",
  created_by: "Devendra Marade", created_at: "2026-10-14T05:00:00Z", company_name: "SHRAK SERVICES", city: "Kalher",
  machine_model: "XM12.7 Handy Printer", contact_person_name: "Pawan Pandey", contact_phone: "7758883615",
  task_status: "Approved", task_allotted_to: "Devendra Marade",
};

describe("TechnicalCallLogsPage", () => {
  afterEach(() => cleanup());

  it("lists call logs with task details", async () => {
    vi.spyOn(api, "fetchCallLogReport").mockResolvedValue({
      data: [row] as any, meta: { total: 1, pagination: { total_records: 1 } } as any,
    });
    render(<MemoryRouter><TechnicalCallLogsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("SHRAK SERVICES")).toBeTruthy());
    expect(screen.getByText("Customer asked to call tomorrow")).toBeTruthy();
    expect(screen.getByText("XM12.7 Handy Printer")).toBeTruthy();
  });

  it("sends the date and call type filters to the API", async () => {
    const spy = vi.spyOn(api, "fetchCallLogReport").mockResolvedValue({ data: [], meta: { total: 0 } as any });
    render(<MemoryRouter><TechnicalCallLogsPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Call date from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByDisplayValue("All"), { target: { value: "Physical Visit" } });
    await waitFor(() => {
      const last = spy.mock.calls[spy.mock.calls.length - 1][0] as Record<string, unknown>;
      expect(last.date_from).toBe("2026-10-01");
      expect(last.call_type).toBe("Physical Visit");
    });
    expect(await screen.findByText(/No call logs found/i)).toBeTruthy();
  });

  it("shows an error with retry when the report fails", async () => {
    vi.spyOn(api, "fetchCallLogReport").mockRejectedValue(new Error("Server unavailable"));
    render(<MemoryRouter><TechnicalCallLogsPage /></MemoryRouter>);
    expect(await screen.findByText(/Server unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
