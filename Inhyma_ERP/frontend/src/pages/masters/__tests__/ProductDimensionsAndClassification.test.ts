import { describe, expect, it } from "vitest";
import { computeCbm } from "@/pages/masters/Products";

describe("Product Master: Client CBM Rounding Rule & Dimensions", () => {
  it("enforces client rounding rule: <= 0.025 -> 0.02 and 0.026 - 0.029 -> 0.03", () => {
    // 25,000 cm3 -> raw 0.025 -> 0.02
    expect(computeCbm(100, 50, 5)).toBe("0.02");

    // 24,000 cm3 -> raw 0.024 -> 0.02
    expect(computeCbm(100, 48, 5)).toBe("0.02");

    // 26,000 cm3 -> raw 0.026 -> 0.03
    expect(computeCbm(100, 52, 5)).toBe("0.03");

    // 29,000 cm3 -> raw 0.029 -> 0.03
    expect(computeCbm(100, 58, 5)).toBe("0.03");

    // 125,000 cm3 -> raw 0.125 -> 0.12
    expect(computeCbm(50, 50, 50)).toBe("0.12");

    // 126,000 cm3 -> raw 0.126 -> 0.13
    expect(computeCbm(60, 60, 35)).toBe("0.13");
  });

  it("handles string and number inputs correctly with invalid fallbacks", () => {
    expect(computeCbm("100", "50", "5")).toBe("0.02");
    expect(computeCbm("0", "50", "5")).toBe("");
    expect(computeCbm("", "", "")).toBe("");
    expect(computeCbm(undefined, undefined, undefined)).toBe("");
  });
});
