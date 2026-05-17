import type { ApplyDeployBranchOverridesOptions } from './deploy-target.util';

/** GraphQL / service input shape for optional deploy branch overrides. */
export interface DeployBranchOptionsInput {
  defaultBranch?: string;
  deployRefs?: {
    dev?: string;
    stg?: string;
    prod?: string;
  };
  useDefaultBranchForAllDeployTargets?: boolean;
}

/**
 * Resolves the Git ref used to trigger a pipeline after migrate/register wiring.
 */
export function resolvePipelineBranchRef(
  options: DeployBranchOptionsInput | undefined,
  gitlabDefaultBranch?: string,
): string {
  const explicit = options?.defaultBranch?.trim();
  if (explicit) {
    return explicit;
  }
  const fromGitLab = gitlabDefaultBranch?.trim();
  if (fromGitLab) {
    return fromGitLab;
  }
  return 'main';
}

/** Maps API input to deploy-target override options. */
export function toDeployBranchOverrideOptions(
  input: DeployBranchOptionsInput | undefined,
): ApplyDeployBranchOverridesOptions | undefined {
  if (!input) {
    return undefined;
  }

  const defaultBranch = input.defaultBranch?.trim();
  const deployRefs = input.deployRefs;
  const hasDeployRefs =
    !!deployRefs?.dev?.trim() || !!deployRefs?.stg?.trim() || !!deployRefs?.prod?.trim();

  if (!defaultBranch && !hasDeployRefs && !input.useDefaultBranchForAllDeployTargets) {
    return undefined;
  }

  return {
    defaultBranch,
    deployRefs: deployRefs
      ? {
          dev: deployRefs.dev?.trim() || undefined,
          stg: deployRefs.stg?.trim() || undefined,
          prod: deployRefs.prod?.trim() || undefined,
        }
      : undefined,
    useDefaultBranchForAllDeployTargets: input.useDefaultBranchForAllDeployTargets,
  };
}
