/**
 * Shape and validation of console-managed merge request approval rules.
 *
 * The stored JSON has the same shape as `.gitlab/approvals.yml`, and the limits
 * here mirror the GitLab plugin's parser (gitlab/plugins/approvals/rules.rb).
 * The plugin validates again on read and blocks merging on anything invalid, so
 * a mismatch fails closed, never open.
 */

export interface ApprovalRuleConfig {
  name: string;
  required: number;
  paths?: string[];
  approvers?: { users?: string[]; groups?: string[] };
}

export interface ApprovalRulesConfig {
  rules: ApprovalRuleConfig[];
  author_can_approve: boolean;
  committers_can_approve: boolean;
  reset_on_push: boolean;
}

export interface ApprovalRuleDraft {
  name: string;
  required: number;
  paths?: string[] | null;
  users?: string[] | null;
  groups?: string[] | null;
}

export interface ApprovalRulesDraft {
  rules: ApprovalRuleDraft[];
  authorCanApprove?: boolean | null;
  committersCanApprove?: boolean | null;
  resetOnPush?: boolean | null;
}

export const MAX_RULES = 50;
export const MAX_REQUIRED = 25;
const MAX_LIST = 50;
const MAX_TEXT = 200;

const clean = (values: string[] | null | undefined, stripAt = false): string[] => {
  const out: string[] = [];
  for (const raw of values ?? []) {
    let value = String(raw).trim();
    if (stripAt) value = value.replace(/^@/, '');
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
};

/**
 * Normalizes console input into the stored config.
 *
 * @returns the config, or the list of problems that make it unusable
 */
export function buildApprovalRulesConfig(
  draft: ApprovalRulesDraft,
): { config: ApprovalRulesConfig; errors: [] } | { config: null; errors: string[] } {
  const errors: string[] = [];
  const rules: ApprovalRuleConfig[] = [];
  const names = new Set<string>();

  if (!draft.rules?.length) errors.push('Add at least one rule.');
  if ((draft.rules?.length ?? 0) > MAX_RULES) errors.push(`At most ${MAX_RULES} rules.`);

  for (const [index, item] of (draft.rules ?? []).entries()) {
    const name = String(item.name ?? '').trim();
    const label = name || `Rule #${index + 1}`;

    if (!name) errors.push(`Rule #${index + 1}: name is required.`);
    else if (name.length > MAX_TEXT) errors.push(`${label.slice(0, 40)}…: name is too long.`);
    else if (names.has(name)) errors.push(`Duplicate rule name: ${name}.`);
    names.add(name);

    if (!Number.isInteger(item.required) || item.required < 1 || item.required > MAX_REQUIRED) {
      errors.push(`${label}: required approvals must be a whole number from 1 to ${MAX_REQUIRED}.`);
    }

    const paths = clean(item.paths);
    const users = clean(item.users, true);
    const groups = clean(item.groups, true);
    for (const [kind, list] of [
      ['paths', paths],
      ['users', users],
      ['groups', groups],
    ] as const) {
      if (list.length > MAX_LIST) errors.push(`${label}: at most ${MAX_LIST} ${kind}.`);
      if (list.some((v) => v.length > MAX_TEXT))
        errors.push(`${label}: a ${kind} entry is too long.`);
    }

    const rule: ApprovalRuleConfig = { name, required: item.required };
    if (paths.length) rule.paths = paths;
    if (users.length || groups.length) {
      rule.approvers = {};
      if (users.length) rule.approvers.users = users;
      if (groups.length) rule.approvers.groups = groups;
    }
    rules.push(rule);
  }

  if (errors.length) return { config: null, errors };

  return {
    config: {
      rules,
      author_can_approve: draft.authorCanApprove ?? false,
      committers_can_approve: draft.committersCanApprove ?? true,
      reset_on_push: draft.resetOnPush ?? true,
    },
    errors: [],
  };
}

/** Every distinct user and group named by any rule. */
export function approversIn(config: ApprovalRulesConfig): { users: string[]; groups: string[] } {
  const users = new Set<string>();
  const groups = new Set<string>();
  for (const rule of config.rules) {
    rule.approvers?.users?.forEach((u) => users.add(u));
    rule.approvers?.groups?.forEach((g) => groups.add(g));
  }
  return { users: [...users], groups: [...groups] };
}
