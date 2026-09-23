import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DatePicker, parseDDMMYYYY, formatDDMMYYYY } from "../DatePicker";

describe("DatePicker Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("parses and formats DD-MM-YYYY dates correctly", () => {
    const d = parseDDMMYYYY("21-09-2026");
    expect(d).not.toBeNull();
    expect(d?.getDate()).toBe(21);
    expect(d?.getMonth()).toBe(8); // 0-indexed September
    expect(d?.getFullYear()).toBe(2026);

    const formatted = formatDDMMYYYY(new Date(2026, 8, 21));
    expect(formatted).toBe("21-09-2026");
  });

  it("renders input with initial value and opens calendar on click", () => {
    const handleChange = vi.fn();
    render(
      <DatePicker
        value="21-09-2026"
        onChange={handleChange}
        ariaLabel="Expected Delivery Date"
      />
    );

    const input = screen.getByLabelText("Expected Delivery Date");
    expect((input as HTMLInputElement).value).toBe("21-09-2026");

    // Calendar dropdown initially not rendered
    expect(screen.queryByTestId("datepicker-dropdown")).toBeNull();

    // Click input to open calendar
    fireEvent.click(input);
    const dropdown = screen.getByTestId("datepicker-dropdown");
    expect(dropdown).toBeTruthy();

    // Contains month header and weekday labels matching legacy ERP screenshot
    expect(screen.getByText(/SEPTEMBER 2026/i)).toBeTruthy();
    expect(screen.getByText("SU")).toBeTruthy();
    expect(screen.getByText("MO")).toBeTruthy();
    expect(screen.getByText("TU")).toBeTruthy();
    expect(screen.getByText("WE")).toBeTruthy();
    expect(screen.getByText("TH")).toBeTruthy();
    expect(screen.getByText("FR")).toBeTruthy();
    expect(screen.getByText("SA")).toBeTruthy();
  });

  it("navigates months on previous/next buttons", () => {
    const handleChange = vi.fn();
    render(
      <DatePicker
        value="21-09-2026"
        onChange={handleChange}
      />
    );

    const input = screen.getByLabelText("Expected Delivery Date");
    fireEvent.click(input);

    expect(screen.getByText(/SEPTEMBER 2026/i)).toBeTruthy();

    // Click previous month
    const prevBtn = screen.getByRole("button", { name: /previous month/i });
    fireEvent.click(prevBtn);
    expect(screen.getByText(/AUGUST 2026/i)).toBeTruthy();

    // Click next month twice
    const nextBtn = screen.getByRole("button", { name: /next month/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText(/SEPTEMBER 2026/i)).toBeTruthy();
    fireEvent.click(nextBtn);
    expect(screen.getByText(/OCTOBER 2026/i)).toBeTruthy();
  });

  it("selects a day and formats date as DD-MM-YYYY", () => {
    const handleChange = vi.fn();
    render(
      <DatePicker
        value="21-09-2026"
        onChange={handleChange}
      />
    );

    const input = screen.getByLabelText("Expected Delivery Date");
    fireEvent.click(input);

    // Find and click day 25
    const day25Btn = screen.getByRole("button", { name: "25" });
    fireEvent.click(day25Btn);

    expect(handleChange).toHaveBeenCalledWith("25-09-2026");
    // Dropdown closes after selection
    expect(screen.queryByTestId("datepicker-dropdown")).toBeNull();
  });

  it("closes dropdown when clicking outside", () => {
    render(
      <div>
        <div data-testid="outside">Outside Element</div>
        <DatePicker value="21-09-2026" onChange={() => {}} />
      </div>
    );

    const input = screen.getByLabelText("Expected Delivery Date");
    fireEvent.click(input);
    expect(screen.getByTestId("datepicker-dropdown")).toBeTruthy();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("datepicker-dropdown")).toBeNull();
  });
});
