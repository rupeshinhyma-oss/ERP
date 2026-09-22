import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./lib/toast";
import "./styles/style.css";
import "./styles/pages.css";

// Globally prevent mouse wheel from changing input[type=number] values when scrolling
window.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.type === "number") {
      target.blur();
    }
    if (
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type === "number"
    ) {
      document.activeElement.blur();
    }
  },
  { passive: true }
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary title="The application failed to load.">
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);