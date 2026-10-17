import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalHistorySync } from "@/lib/hooks";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mirrors the Companies page: a "full form" hook declared before the "quick drawer" hook. */
function Harness() {
  const [quick, setQuick] = useState(false);
  const [full, setFull] = useState(false);
  useModalHistorySync(full, () => setFull(false));
  useModalHistorySync(quick, () => setQuick(false));
  return (
    <div>
      <button onClick={() => setQuick(true)}>open-quick</button>
      <button onClick={() => { setQuick(false); setFull(true); }}>save-continue</button>
      <button onClick={() => setFull(false)}>close-full</button>
      <span data-testid="quick">{String(quick)}</span>
      <span data-testid="full">{String(full)}</span>
    </div>
  );
}

describe("useModalHistorySync - closing one modal while opening another (Save & Continue)", () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;
  let backSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom does not fire popstate for history.back(); take control of it so the browser behaviour is explicit.
    backSpy = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    pushSpy = vi.spyOn(window.history, "pushState");
  });
  afterEach(() => {
    cleanup(); // unmounting an open modal issues its own history.back()
    window.dispatchEvent(new PopStateEvent("popstate")); // let the "browser" finish it so no state leaks between tests
    vi.restoreAllMocks();
  });

  it("the new modal waits for the in-flight back and ignores its popstate (used to close itself)", async () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByText("open-quick"));
    await act(async () => { await wait(10); });
    expect(pushSpy).toHaveBeenCalledTimes(1); // quick drawer's dummy entry

    // Save & Continue: quick closes (history.back) while the full form opens, in the same moment.
    await act(async () => { fireEvent.click(screen.getByText("save-continue")); await wait(10); });
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1); // full form has NOT pushed yet: it waits for the back to finish
    expect(screen.getByTestId("full").textContent).toBe("true");

    // The browser finishes the back: popstate must not reach the new modal...
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); await wait(10); });
    expect(screen.getByTestId("full").textContent).toBe("true");
    expect(pushSpy).toHaveBeenCalledTimes(2); // ...and only now does the full form push its own entry

    // A genuine Back press afterwards still closes it.
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); await wait(10); });
    expect(screen.getByTestId("full").textContent).toBe("false");
  });

  it("does not wait forever if the browser never reports the back (safety timeout)", async () => {
    vi.useFakeTimers();
    try {
      render(<MemoryRouter><Harness /></MemoryRouter>);
      fireEvent.click(screen.getByText("open-quick"));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      await act(async () => { fireEvent.click(screen.getByText("save-continue")); await vi.advanceTimersByTimeAsync(100); });
      expect(pushSpy).toHaveBeenCalledTimes(1); // still waiting
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(screen.getByTestId("full").textContent).toBe("true");
      expect(pushSpy).toHaveBeenCalledTimes(2); // gave up waiting and pushed its entry
    } finally {
      vi.useRealTimers();
    }
  });

  it("opening and closing a single modal behaves as before (no waiting, one push, one back)", async () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByText("open-quick"));
    await act(async () => { await wait(10); });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();
  });
});
