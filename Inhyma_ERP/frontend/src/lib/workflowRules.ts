/**
 * Workflow rules configured in the database (option_lists `meta`), evaluated for the signed-in user.
 *
 * The server enforces the same rules; this only decides which buttons to show. Nothing about a
 * specific document type is hardcoded here -- statuses, transitions and permissions all come from the rules.
 */

export interface WorkflowRule {
  label?: string;
  next: string[];
  admin_only_to?: string[];
  perm_to?: Record<string, string>;
  reason_required_to?: string[];
  edit?: string;
  delete?: boolean | string;
  initial?: boolean;
  stock_in?: boolean;
  action_label?: string;
  action_color?: string;
  badge?: string;
  card_label?: string;
}

export type WorkflowRules = Record<string, WorkflowRule>;

export interface Actor {
  isAdmin: boolean;
  has: (permission: string) => boolean;
}

/** "any" | true -> everyone; "admin" -> admins; "perm:<code>" -> admins or holders of <code>; otherwise nobody. */
function allowed(mode: unknown, actor: Actor): boolean {
  if (mode === true || mode === "any") return true;
  if (mode === "admin") return actor.isAdmin;
  if (typeof mode === "string" && mode.startsWith("perm:")) return actor.isAdmin || actor.has(mode.slice(5));
  return false;
}

export function canEdit(rules: WorkflowRules, status: string, actor: Actor): boolean {
  return allowed(rules[status]?.edit, actor);
}

export function canDelete(rules: WorkflowRules, status: string, actor: Actor): boolean {
  return allowed(rules[status]?.delete, actor);
}

/** The statuses this user may move a document to from `status`. */
export function availableTransitions(rules: WorkflowRules, status: string, actor: Actor): string[] {
  const rule = rules[status];
  if (!rule) return [];
  return rule.next.filter((target) => {
    if ((rule.admin_only_to || []).includes(target) && !actor.isAdmin) return false;
    const needed = rule.perm_to?.[target];
    return !needed || actor.isAdmin || actor.has(needed);
  });
}

export function needsReason(rules: WorkflowRules, status: string, target: string): boolean {
  return (rules[status]?.reason_required_to || []).includes(target);
}

/** Display label for a status key, from the rules (falls back to a tidied key). */
export function statusLabel(rules: WorkflowRules, status: string): string {
  return rules[status]?.label || status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}