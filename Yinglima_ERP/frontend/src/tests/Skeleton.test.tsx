// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  TableSkeletonRows,
  CardGridSkeleton,
  DetailSkeleton,
  InlineListSkeleton,
  InlineTextSkeleton,
} from "../components/Skeleton";

afterEach(() => {
  cleanup();
});

describe("Yinglima Ghost / Skeleton Loading Components", () => {
  it("renders TableSkeletonRows with expected rows, columns, and shimmer lines", () => {
    const { container } = render(
      <table>
        <tbody>
          <TableSkeletonRows colCount={6} rowCount={3} />
        </tbody>
      </table>
    );

    const rows = container.querySelectorAll('tr[data-testid="skeleton-row"]');
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute("aria-hidden")).toBe("true");
    expect(rows[0].querySelectorAll("td")).toHaveLength(6);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(18);
  });

  it("renders CardGridSkeleton with cards and optional avatars", () => {
    const { container } = render(<CardGridSkeleton count={2} lines={3} showAvatar />);
    expect(container.querySelectorAll('[data-testid="skeleton-card-grid"]')).toHaveLength(1);
    expect(container.querySelectorAll(".skeleton-circle")).toHaveLength(2);
    // 2 cards * 3 lines each = 6 lines
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(6);
  });

  it("renders DetailSkeleton in light and dark variants", () => {
    const { container, rerender } = render(<DetailSkeleton stripCount={3} rows={2} />);
    expect(container.querySelectorAll(".skeleton-line").length).toBeGreaterThanOrEqual(6);

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
        <InlineListSkeleton count={3} showAvatar compact />
        <InlineTextSkeleton width={100} height={14} />
      </div>
    );
    expect(container.querySelectorAll(".skeleton-circle")).toHaveLength(3);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(4);

    rerender(<InlineListSkeleton count={2} compact={false} />);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(4);
  });
});
