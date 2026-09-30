import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./lib/toast";
import "./index.css";
import "./styles/style.css";
import "./styles/control-plane.css";

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

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary title="The ERP_Main Control Plane failed to load.">
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>
  );
}
