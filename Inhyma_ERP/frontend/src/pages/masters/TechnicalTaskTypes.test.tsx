import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TechnicalTaskTypesPage } from "./TechnicalTaskTypes";
import { apiGet, apiPost, apiPut } from "@/lib/api";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn().mockResolvedValue({ data: {} }),
  apiPut: vi.fn().mockResolvedValue({ data: {} }),
  apiDelete: vi.fn().mockResolvedValue({ data: {} }),
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const options = [
  { id: "o1", value: "Telecall", label: "Telecall", sort_order: 1, status: "active" },
  { id: "o2", value: "In-house", label: "In-house", sort_order: 2, status: "active" },
];

describe("TechnicalTaskTypesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiGet as any).mockResolvedValue({ data: options });
  });
  afterEach(() => cleanup());

  it("lists task types and adds a new one", async () => {
    render(<MemoryRouter><TechnicalTaskTypesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Telecall")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/New task type/i), { target: { value: "Remote Support" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/masters/options", expect.objectContaining({ group_key: "technical_task.task_type", value: "Remote Support" }))
    );
  });

  it("rejects a duplicate task type without calling the API", async () => {
    render(<MemoryRouter><TechnicalTaskTypesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Telecall")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/New task type/i), { target: { value: "telecall" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    expect(await screen.findByText(/already exists/i)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("deactivates a task type", async () => {
    render(<MemoryRouter><TechnicalTaskTypesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Telecall")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "Deactivate" })[0]);
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith("/masters/options/o1", { status: "inactive" }));
  });
});
