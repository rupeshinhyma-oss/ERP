import type React from "react";

/**
 * Prevents accidental form submission when pressing Enter in text/select fields,
 * and instead advances focus to the next visible, interactive form element (like Tab).
 *
 * Rules:
 * - Enter on <textarea> is allowed (creates new lines).
 * - Enter on <button> or type="submit" is allowed (deliberate button click).
 * - Ctrl+Enter or Cmd+Enter is allowed (power-user keyboard shortcut to submit).
 * - Enter on any other input/select will prevent submission and focus the next field.
 */
export function handleFormEnterKeyNavigation(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter") return;

  // Allow Ctrl+Enter or Cmd+Enter to submit deliberately
  if (e.ctrlKey || e.metaKey) return;

  const target = e.target as HTMLElement | null;
  if (!target) return;

  // Allow Enter in textarea or on buttons
  const tagName = target.tagName.toUpperCase();
  if (tagName === "TEXTAREA" || tagName === "BUTTON" || (target as HTMLInputElement).type === "submit") {
    return;
  }

  // Prevent default form submit
  e.preventDefault();

  // Find all focusable interactive elements within the form
  const form = e.currentTarget;
  const focusable = Array.from(
    form.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])'
    )
  ).filter((el) => {
    // Only visible elements
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  });

  const currentIndex = focusable.indexOf(target);
  if (currentIndex > -1 && currentIndex < focusable.length - 1) {
    const nextEl = focusable[currentIndex + 1];
    nextEl.focus();
    if (nextEl instanceof HTMLInputElement && (nextEl.type === "text" || nextEl.type === "number" || nextEl.type === "email")) {
      nextEl.select?.();
    }
  }
}
