import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Combobox } from "../Combobox";

describe("Combobox Component (Write + Dropdown)", () => {
  const sampleOptions = ["Mumbai", "Ahmedabad", "Indore", "Delhi", "Bangalore", "Chennai"];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders input with initial value", () => {
    render(
      <Combobox
        value="Mumbai"
        onChange={() => {}}
        options={sampleOptions}
        ariaLabel="Warehouse"
      />
    );

    const input = screen.getByLabelText("Warehouse");
    expect((input as HTMLInputElement).value).toBe("Mumbai");
  });

  it("allows typing custom text directly (write option)", () => {
    const handleChange = vi.fn();
    render(
      <Combobox
        value=""
        onChange={handleChange}
        options={sampleOptions}
        ariaLabel="Warehouse"
      />
    );

    const input = screen.getByLabelText("Warehouse");
    fireEvent.change(input, { target: { value: "Pune Hub" } });

    expect(handleChange).toHaveBeenCalledWith("Pune Hub");
    expect((input as HTMLInputElement).value).toBe("Pune Hub");
  });

  it("opens dropdown and filters options when typing", () => {
    render(
      <Combobox
        value=""
        onChange={() => {}}
        options={sampleOptions}
        ariaLabel="Warehouse"
      />
    );

    const input = screen.getByLabelText("Warehouse");
    fireEvent.change(input, { target: { value: "Del" } });

    // Dropdown is open
    expect(screen.getByTestId("combobox-options")).toBeTruthy();
    // Delhi is shown in the options
    expect(screen.getByText("Delhi")).toBeTruthy();
    // Mumbai is filtered out
    expect(screen.queryByText("Mumbai")).toBeNull();
  });

  it("opens dropdown on chevron toggle button click and selects an option", () => {
    const handleChange = vi.fn();
    render(
      <Combobox
        value="Select"
        onChange={handleChange}
        options={sampleOptions}
        ariaLabel="Warehouse"
      />
    );

    const toggleBtn = screen.getByRole("button", { name: /toggle warehouse options/i });
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId("combobox-options")).toBeTruthy();
    expect(screen.getByText("Bangalore")).toBeTruthy();

    // Click Bangalore
    fireEvent.click(screen.getByText("Bangalore"));
    expect(handleChange).toHaveBeenCalledWith("Bangalore");
    expect(screen.queryByTestId("combobox-options")).toBeNull();
  });

  it("supports keyboard navigation (ArrowDown and Enter)", () => {
    const handleChange = vi.fn();
    render(
      <Combobox
        value=""
        onChange={handleChange}
        options={["Option 1", "Option 2"]}
        ariaLabel="Test Combobox"
      />
    );

    const input = screen.getByLabelText("Test Combobox");
    // Press ArrowDown to open dropdown
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByTestId("combobox-options")).toBeTruthy();

    // Press ArrowDown again to move to next
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Press Enter to select
    fireEvent.keyDown(input, { key: "Enter" });

    expect(handleChange).toHaveBeenCalled();
  });

  it("closes dropdown on Escape key or outside click", () => {
    render(
      <div>
        <div data-testid="outside-area">Outside</div>
        <Combobox
          value="Select"
          onChange={() => {}}
          options={sampleOptions}
          ariaLabel="Warehouse"
        />
      </div>
    );

    const toggleBtn = screen.getByRole("button", { name: /toggle warehouse options/i });
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("combobox-options")).toBeTruthy();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId("outside-area"));
    expect(screen.queryByTestId("combobox-options")).toBeNull();
  });
});
