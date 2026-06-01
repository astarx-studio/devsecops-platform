import type { ClusterProfile } from '../schemas/project.schema';

/** Single-word sentinel: deploy jobs for that target must not run. */
export const DEPLOY_REF_DISABLED = 'none';

/** Standard deployment target keys shipped with the platform template. */
export const STANDARD_DEPLOY_TARGET_KEYS = ['dev', 'stg', 'prod'] as const;

export type StandardDeployTargetKey = (typeof STANDARD_DEPLOY_TARGET_KEYS)[number];

/** Default branch refs for standard targets (overridable per project). */
export const DEFAULT_DEPLOY_REFS: Record<StandardDeployTargetKey, string> = {
  dev: 'develop',
  stg: 'staging',
  prod: 'main',
};

/** Path to the API-generated CI fragment in app repos. */
export const DEPLOY_TARGETS_CI_PATH = '.dsoaas/deploy-targets.gitlab-ci.yml';

/** Per-app Kaniko build job overrides. */
export const BUILD_JOBS_CI_PATH = '.dsoaas/build-jobs.gitlab-ci.yml';

/** GitLab CI environment_scope / K8s labels use the target key by default. */
export function defaultGitlabEnvironment(targetKey: string): string {
  return targetKey;
}
