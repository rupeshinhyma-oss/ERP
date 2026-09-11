/**
 * ErrorBoundary for ERP_Main Control Plane.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught a render error:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div
        style={{
          margin: "40px auto",
          maxWidth: "560px",
          padding: "28px",
          textAlign: "center",
        }}
      >
        <div
          className="error-banner"
          style={{ textAlign: "left", marginBottom: "16px" }}
        >
          <strong>{this.props.title || "Something went wrong."}</strong>
          <div style={{ marginTop: "6px", opacity: 0.85 }}>
            {error.message || "An unexpected error occurred while rendering this page."}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
          <button type="button" className="btn btn-primary" onClick={this.reset}>
            Try Again
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </div>
      </div>
    );
  }
}
