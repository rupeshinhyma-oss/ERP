/**
 * Global Autocomplete & Autofill Blocker.
 *
 * Automatically suppresses intrusive browser autofill popups, previously-typed
 * dropdown history bubbles (such as company/user name suggestions), and password-manager
 * overlays across all form fields in the ERP Dashboard / Control Plane.
 */

export function initGlobalAutocompleteBlocker(): () => void {
  const sanitizeElement = (el: Element) => {
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.type !== "password"
    ) {
      if (!el.hasAttribute("autocomplete") || el.getAttribute("autocomplete") === "on") {
        el.setAttribute("autocomplete", "off");
      }
      if (!el.hasAttribute("data-lpignore")) {
        el.setAttribute("data-lpignore", "true");
      }
      if (!el.hasAttribute("data-form-type")) {
        el.setAttribute("data-form-type", "other");
      }
    } else if (el instanceof HTMLFormElement) {
      if (!el.hasAttribute("autocomplete") || el.getAttribute("autocomplete") === "on") {
        el.setAttribute("autocomplete", "off");
      }
    }
  };

  // 1. Initial DOM sweep
  if (typeof document !== "undefined") {
    document.querySelectorAll("input, textarea, form").forEach(sanitizeElement);
  }

  // 2. Continuous DOM observer for dynamic modals, slide-overs, and drawers
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            if (node.matches && node.matches("input, textarea, form")) {
              sanitizeElement(node);
            }
            if (node.querySelectorAll) {
              const children = node.querySelectorAll("input, textarea, form");
              for (let i = 0; i < children.length; i++) {
                sanitizeElement(children[i]);
              }
            }
          }
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // 3. Capture-phase focus listener to catch any input upon user interaction
  const handleFocusIn = (e: FocusEvent) => {
    const target = e.target;
    if (
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      target.type !== "password"
    ) {
      if (!target.hasAttribute("autocomplete") || target.getAttribute("autocomplete") === "on") {
        target.setAttribute("autocomplete", "off");
      }
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("focusin", handleFocusIn, true);
  }

  return () => {
    if (observer) observer.disconnect();
    if (typeof document !== "undefined") {
      document.removeEventListener("focusin", handleFocusIn, true);
    }
  };
}
