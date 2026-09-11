import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  StatusBadge,
  Banner,
  LoadingSpinner,
  SkeletonTable,
  EmptyState,
} from "../components/ui";

describe("UI State Primitives", () => {
  it("renders status badges with appropriate styles", () => {
    const { rerender } = render(<StatusBadge status="ACTIVE" />);
    expect(screen.getByText("Active")).toBeDefined();

    rerender(<StatusBadge status="SUSPENDED" />);
    expect(screen.getByText("Suspended")).toBeDefined();

    rerender(<StatusBadge status="DECOMMISSIONED" />);
    expect(screen.getByText("Decommissioned")).toBeDefined();

    rerender(<StatusBadge status="CONFLICT" />);
    expect(screen.getByText("Conflict")).toBeDefined();
  });

  it("renders error banners correctly", () => {
    render(<Banner error="Database connection failed" />);
    expect(screen.getByText("Database connection failed")).toBeDefined();
  });

  it("renders success banners correctly", () => {
    render(<Banner success="Operation completed successfully" />);
    expect(screen.getByText("Operation completed successfully")).toBeDefined();
  });

  it("renders loading spinners and skeletons", () => {
    const { unmount } = render(<LoadingSpinner text="Fetching fleet status..." />);
    expect(screen.getByText("Fetching fleet status...")).toBeDefined();
    unmount();

    render(<SkeletonTable rows={3} cols={2} />);
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);
  });

  it("renders empty states with title and description", () => {
    render(
      <EmptyState
        title="No ERP instances found"
        description="Please register a new instance."
      />
    );
    expect(screen.getByText("No ERP instances found")).toBeDefined();
    expect(screen.getByText("Please register a new instance.")).toBeDefined();
  });
});
