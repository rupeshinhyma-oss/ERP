import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Browser-history bookkeeping shared by every modal / drawer that uses `useModalHistorySync`.
 *
 * Problem this solves ("Save & Continue" on the Quick Add drawer used to just close everything):
 * closing a modal calls `history.back()` to remove its dummy history entry. When another modal is opened in
 * the SAME moment (Quick Add drawer closes -> full Add Company form opens), the new modal pushes its own dummy
 * entry before the asynchronous "back" has finished. The browser then finishes the back, fires `popstate`, and
 * the NEW modal mistakes it for the user pressing Back -- so it closes itself immediately.
 *
 * Fix: every programmatic back is tracked; a modal that opens while one is still in flight waits until the
 * browser has finished it (its `popstate`, or a short safety timeout) before it pushes its entry and starts
 * listening. With no back in flight nothing waits, so normal open/close behaves exactly as before.
 */
const BACK_SAFETY_TIMEOUT_MS = 500;

let backsInFlight = 0;
let settleWaiters: Array<() => void> = [];
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let backListenerAttached = false;

function flushSettleWaiters(): void {
  backsInFlight = 0;
  if (settleTimer !== undefined) clearTimeout(settleTimer);
  settleTimer = undefined;
  const waiters = settleWaiters;
  settleWaiters = [];
  waiters.forEach((run) => run());
}

function onPopStateForBacks(): void {
  if (backsInFlight > 0) {
    backsInFlight -= 1;
    if (backsInFlight === 0) flushSettleWaiters();
  }
}

/** `history.back()` that remembers it is in flight. */
function issueHistoryBack(): void {
  backsInFlight += 1;
  if (!backListenerAttached) {
    window.addEventListener("popstate", onPopStateForBacks);
    backListenerAttached = true;
  }
  if (settleTimer !== undefined) clearTimeout(settleTimer);
  // If the browser never reports the traversal (e.g. nothing to go back to), do not wait forever.
  settleTimer = setTimeout(flushSettleWaiters, BACK_SAFETY_TIMEOUT_MS);
  window.history.back();
}

/** Run `run` once no programmatic back is in flight (immediately when none is). */
function whenBacksSettled(run: () => void): void {
  if (backsInFlight === 0) {
    run();
  } else {
    settleWaiters.push(run);
  }
}

/**
 * Syncs browser back-button with a modal / drawer's open state.
 *
 * When `isOpen` becomes true a dummy history entry is pushed so that pressing
 * the browser's Back button (left arrow) smoothly closes the modal/form and keeps
 * the user on the current page's table list.
 *
 * Route navigation safety: If the user clicks a sidebar link or navigates away to
 * another route, unmount cleanup detects the pathname change and skips history.back(),
 * ensuring instant 1-click navigation without cancelled routes.
 *
 * Hand-off safety: closing one modal while opening another in the same moment is supported
 * (see the note at the top of this file).
 */
export function useModalHistorySync(isOpen: boolean, onClose: () => void): void {
  const isPopStateRef = useRef(false);
  const hasPushedRef = useRef(false);
  const location = useLocation();
  const currentPathRef = useRef(location.pathname);
  currentPathRef.current = location.pathname;

  useEffect(() => {
    if (!isOpen) {
      if (hasPushedRef.current && !isPopStateRef.current) {
        hasPushedRef.current = false;
        if (window.location.pathname === currentPathRef.current) {
          issueHistoryBack();
        }
      }
      isPopStateRef.current = false;
      return;
    }

    let cancelled = false;
    let listening = false;

    const handlePopState = () => {
      isPopStateRef.current = true;
      hasPushedRef.current = false;
      onClose();
    };

    // Modal just opened: push the dummy history state (after any in-flight back has finished).
    whenBacksSettled(() => {
      if (cancelled) return;
      window.history.pushState({ modalHistorySync: true }, "");
      hasPushedRef.current = true;
      isPopStateRef.current = false;
      window.addEventListener("popstate", handlePopState);
      listening = true;
    });

    return () => {
      cancelled = true;
      if (listening) window.removeEventListener("popstate", handlePopState);
      // Clean up dummy entry ONLY if unmounting on the exact same page without popstate
      if (hasPushedRef.current && !isPopStateRef.current) {
        if (window.location.pathname === currentPathRef.current) {
          issueHistoryBack();
        }
        hasPushedRef.current = false;
      }
      isPopStateRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
