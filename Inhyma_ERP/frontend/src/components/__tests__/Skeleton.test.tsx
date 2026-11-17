// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  TableSkeletonRows,
  CardGridSkeleton,
  DetailSkeleton,
  InlineListSkeleton,
  InlineTextSkeleton,
} from "../Skeleton";

afterEach(() => {
  cleanup();
});

describe("Ghost / Skeleton Loading Components", () => {
  it("renders TableSkeletonRows with expected rows, columns, and shimmer lines", () => {
    const { container } = render(
      <table>
        <tbody>
          <TableSkeletonRows colCount={5} rowCount={4} testId="custom-sk-row" />
        </tbody>
      </table>
    );

    const rows = container.querySelectorAll('tr[data-testid="custom-sk-row"]');
    expect(rows).toHaveLength(4);
    expect(rows[0].getAttribute("aria-hidden")).toBe("true");
    expect(rows[0].querySelectorAll("td")).toHaveLength(5);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(20);
  });

  it("renders CardGridSkeleton with cards and optional avatars", () => {
    const { container } = render(<CardGridSkeleton count={3} lines={2} showAvatar />);
    expect(container.querySelectorAll('[data-testid="skeleton-card-grid"]')).toHaveLength(1);
    expect(container.querySelectorAll(".skeleton-circle")).toHaveLength(3);
    // 3 cards * 2 lines each = 6 lines
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(6);
  });

  it("renders DetailSkeleton in light and dark variants", () => {
    const { container, rerender } = render(<DetailSkeleton stripCount={4} rows={3} />);
    expect(container.querySelectorAll(".skeleton-line").length).toBeGreaterThanOrEqual(8);

    rerender(<DetailSkeleton stripCount={2} rows={2} dark />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("data-testid")).toBe("skeleton-detail");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    const line = container.querySelector(".skeleton-line") as HTMLElement;
    expect(line.style.opacity).toBe("0.25");
  });

  it("renders InlineListSkeleton (compact and full) and InlineTextSkeleton", () => {
    const { container, rerender } = render(
      <div>
        <InlineListSkeleton count={2} showAvatar compact />
        <InlineTextSkeleton width={90} height={16} />
      </div>
    );
    expect(container.querySelectorAll(".skeleton-circle")).toHaveLength(2);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(3);

    rerender(<InlineListSkeleton count={2} compact={false} />);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(4);
  });
});
