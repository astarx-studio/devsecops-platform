import { approversIn, buildApprovalRulesConfig } from './approval-rules.policy';

describe('approval-rules.policy', () => {
  it('normalizes a draft into the plugin config shape with defaults', () => {
    const result = buildApprovalRulesConfig({
      rules: [
        { name: ' default ', required: 2 },
        {
          name: 'security',
          required: 1,
          paths: ['infra/**', ' ', 'infra/**'],
          users: ['@alice', 'alice'],
          groups: ['@platform/security'],
        },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.config).toEqual({
      rules: [
        { name: 'default', required: 2 },
        {
          name: 'security',
          required: 1,
          paths: ['infra/**'],
          approvers: { users: ['alice'], groups: ['platform/security'] },
        },
      ],
      author_can_approve: false,
      committers_can_approve: true,
      reset_on_push: true,
    });
  });

  it('keeps explicit toggles', () => {
    const result = buildApprovalRulesConfig({
      rules: [{ name: 'a', required: 1 }],
      authorCanApprove: true,
      committersCanApprove: false,
      resetOnPush: false,
    });

    expect(result.config).toMatchObject({
      author_can_approve: true,
      committers_can_approve: false,
      reset_on_push: false,
    });
  });

  it('rejects empty, duplicate and out-of-range rules', () => {
    expect(buildApprovalRulesConfig({ rules: [] }).errors).toContain('Add at least one rule.');

    const result = buildApprovalRulesConfig({
      rules: [
        { name: 'a', required: 0 },
        { name: 'a', required: 26 },
        { name: '', required: 1.5 },
      ],
    });

    expect(result.config).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'a: required approvals must be a whole number from 1 to 25.',
        'Duplicate rule name: a.',
        'Rule #3: name is required.',
        'Rule #3: required approvals must be a whole number from 1 to 25.',
      ]),
    );
  });

  it('collects distinct approvers across rules', () => {
    const { config } = buildApprovalRulesConfig({
      rules: [
        { name: 'a', required: 1, users: ['alice', 'bob'], groups: ['g1'] },
        { name: 'b', required: 1, users: ['bob'], groups: ['g1', 'g2'] },
      ],
    });

    expect(approversIn(config!)).toEqual({ users: ['alice', 'bob'], groups: ['g1', 'g2'] });
  });
});
