import { describe, it, expect } from "vitest";
import { availableTransitions, canDelete, canEdit, needsReason, statusLabel, type WorkflowRules } from "../workflowRules";

const rules: WorkflowRules = {
  pending: {
    label: "Pending", next: ["confirmed", "cancelled"], admin_only_to: ["cancelled"], perm_to: { confirmed: "po.confirm" },
    reason_required_to: ["cancelled"], edit: "perm:po.update", delete: "admin",
  },
  confirmed: { label: "Confirmed", next: [], edit: "none", delete: false },
  open: { next: [], edit: "any", delete: true },
};
const user = { isAdmin: false, has: () => false };
const accounts = { isAdmin: false, has: (p: string) => p === "po.confirm" || p === "po.update" };
const admin = { isAdmin: true, has: () => false };

describe("workflow rules", () => {
  it("edit and delete follow any / admin / perm:<code> / none", () => {
    expect([canEdit(rules, "pending", user), canEdit(rules, "pending", accounts), canEdit(rules, "pending", admin)]).toEqual([false, true, true]);
    expect([canDelete(rules, "pending", user), canDelete(rules, "pending", accounts), canDelete(rules, "pending", admin)]).toEqual([false, false, true]);
    expect(canEdit(rules, "confirmed", admin)).toBe(false);          // 'none' means nobody, even an admin
    expect(canDelete(rules, "confirmed", admin)).toBe(false);
    expect(canEdit(rules, "open", user) && canDelete(rules, "open", user)).toBe(true);
    expect(canEdit(rules, "unknown", admin)).toBe(false);
  });

  it("transitions are filtered by admin-only steps and required permissions", () => {
    expect(availableTransitions(rules, "pending", user)).toEqual([]);
    expect(availableTransitions(rules, "pending", accounts)).toEqual(["confirmed"]);
    expect(availableTransitions(rules, "pending", admin)).toEqual(["confirmed", "cancelled"]);
    expect(availableTransitions(rules, "confirmed", admin)).toEqual([]);
  });

  it("knows which steps need a reason and how to label a status", () => {
    expect(needsReason(rules, "pending", "cancelled")).toBe(true);
    expect(needsReason(rules, "pending", "confirmed")).toBe(false);
    expect(statusLabel(rules, "pending")).toBe("Pending");
    expect(statusLabel(rules, "in_review")).toBe("In Review");
  });
});
