import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ScrollableNumberInput } from "../ScrollableNumberInput";

describe("ScrollableNumberInput", () => {
  afterEach(() => {
    cleanup();
  });

  it("increments by 1 on scroll up (deltaY < 0)", () => {
    const handleChange = vi.fn();
    render(<ScrollableNumberInput value="1" onChange={handleChange} minVal={1} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.wheel(input, { deltaY: -100 });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { value: "2" },
      })
    );
  });

  it("decrements by 1 on scroll down (deltaY > 0)", () => {
    const handleChange = vi.fn();
    render(<ScrollableNumberInput value="5" onChange={handleChange} minVal={1} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.wheel(input, { deltaY: 100 });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { value: "4" },
      })
    );
  });

  it("does not decrement below minVal on scroll down", () => {
    const handleChange = vi.fn();
    render(<ScrollableNumberInput value="1" onChange={handleChange} minVal={1} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.wheel(input, { deltaY: 100 });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { value: "1" },
      })
    );
  });

  it("does not increment above maxVal on scroll up", () => {
    const handleChange = vi.fn();
    render(<ScrollableNumberInput value="10" onChange={handleChange} maxVal={10} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.wheel(input, { deltaY: -100 });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { value: "10" },
      })
    );
  });

  it("increments on ArrowUp and decrements on ArrowDown", () => {
    const handleChange = vi.fn();
    render(<ScrollableNumberInput value="3" onChange={handleChange} minVal={1} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { value: "4" },
      })
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { value: "2" },
      })
    );
  });
});
