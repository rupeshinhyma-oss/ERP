import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { NetworkStatusNotifier } from "@/components/NetworkStatusNotifier";

describe("NetworkStatusNotifier (ERP Dashboard)", () => {
  const originalTitle = document.title;

  beforeEach(() => {
    document.title = "ERP Dashboard";
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.title = originalTitle;
    vi.useRealTimers();
  });

  it("does not render when online", () => {
    render(<NetworkStatusNotifier />);
    expect(screen.queryByTestId("network-status-notifier")).toBeNull();
  });

  it("shows offline banner and updates title when window offline event fires", () => {
    render(<NetworkStatusNotifier />);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByTestId("network-status-notifier")).toBeTruthy();
    expect(screen.getByText("No network connection")).toBeTruthy();
    expect(screen.getByText("Please check your internet connection.")).toBeTruthy();
    expect(document.title).toContain("Offline");
  });

  it("shows restored banner when window online event fires and auto-dismisses after 3500ms", () => {
    render(<NetworkStatusNotifier />);

    // Go offline first
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("No network connection")).toBeTruthy();

    // Come back online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.getByText("Internet connection restored")).toBeTruthy();
    expect(screen.getByText("Your system is back online.")).toBeTruthy();

    // Fast-forward past 3500ms
    act(() => {
      vi.advanceTimersByTime(3600);
    });

    expect(screen.queryByTestId("network-status-notifier")).toBeNull();
  });
});
