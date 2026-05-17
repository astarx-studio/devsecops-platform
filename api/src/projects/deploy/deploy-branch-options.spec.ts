import {
  resolvePipelineBranchRef,
  toDeployBranchOverrideOptions,
} from './deploy-branch-options';
import {
  applyDeployBranchOverrides,
  deriveStandardDeploymentTargets,
} from './deploy-target.util';

describe('deploy-branch-options', () => {
  it('resolvePipelineBranchRef prefers explicit default then GitLab', () => {
    expect(resolvePipelineBranchRef({ defaultBranch: 'master' }, 'main')).toBe('master');
    expect(resolvePipelineBranchRef(undefined, 'develop')).toBe('develop');
    expect(resolvePipelineBranchRef(undefined, undefined)).toBe('main');
  });

  it('toDeployBranchOverrideOptions returns undefined when empty', () => {
    expect(toDeployBranchOverrideOptions(undefined)).toBeUndefined();
    expect(toDeployBranchOverrideOptions({})).toBeUndefined();
  });

  it('applyDeployBranchOverrides sets prod and all-targets modes', () => {
    const base = deriveStandardDeploymentTargets('my-app', 'apps.example.com', true);
    const prodOnly = applyDeployBranchOverrides(base, { defaultBranch: 'master' });
    expect(prodOnly.find((t) => t.key === 'prod')?.deployRef).toBe('master');
    expect(prodOnly.find((t) => t.key === 'dev')?.deployRef).toBe('develop');

    const all = applyDeployBranchOverrides(base, {
      defaultBranch: 'master',
      useDefaultBranchForAllDeployTargets: true,
    });
    expect(all.every((t) => t.deployRef === 'master')).toBe(true);
  });
});
