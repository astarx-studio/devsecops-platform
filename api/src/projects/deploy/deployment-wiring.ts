import { BadRequestException } from '@nestjs/common';

import { DEPLOY_REF_DISABLED } from './deploy.constants';
import { deployRefVariableName } from './deploy-target.util';
import {
  assertValidActiveDeployRef,
  assertValidTargetKey,
  buildDefaultAppHost,
  ensureTargetApps,
  inferClusterProfile,
  resolveDefaultDeployRef,
} from './deploy-target.util';
import {
  appEnvironmentScope,
  normalizeTargetApps,
  resolveHelmReleaseName,
  targetUsesPerAppDeploy,
  type NormalizeTargetAppInput,
} from './target-app.util';

import type { ClusterProfile, DeploymentTarget, TargetApp } from '../schemas/project.schema';
import type { DeploymentTargetInput } from '../graphql/project.inputs';

/** CI variable definition for GitLab project variables API. */
export interface DeployCiVariable {
  key: string;
  value: string;
  environmentScope: string;
  masked?: boolean;
}

/**
 * Builds a deployment target from GraphQL/create input.
 */
export function buildDeploymentTargetFromInput(
  input: DeploymentTargetInput,
  effectiveSlug: string,
  appsDomain: string,
  deployableDefault: boolean,
): DeploymentTarget {
  assertValidTargetKey(input.key);

  const enabled = input.enabled ?? deployableDefault;
  const clusterProfile =
    (input.clusterProfile as ClusterProfile | undefined) ?? inferClusterProfile(input.key);

  if (!clusterProfile) {
    throw new BadRequestException(
      `clusterProfile is required for non-standard target key "${input.key}"`,
    );
  }

  let deployRef: string;
  if (!enabled) {
    deployRef = DEPLOY_REF_DISABLED;
  } else {
    const resolved = input.deployRef ?? resolveDefaultDeployRef(input.key);
    if (!resolved) {
      throw new BadRequestException(
        `deployRef is required when enabling custom target "${input.key}"`,
      );
    }
    deployRef = resolved;
  }

  assertValidActiveDeployRef(deployRef, enabled);

  const appInputs: NormalizeTargetAppInput[] = input.apps?.map((a) => ({
    name: a.name,
    image: a.image,
    dockerfile: a.dockerfile,
    host: a.host,
  })) ?? [
    {
      name: effectiveSlug,
      image: effectiveSlug,
      dockerfile: 'Dockerfile',
      host: input.appHost,
    },
  ];

  const apps = normalizeTargetApps(appInputs, input.key, appsDomain);

  return {
    key: input.key,
    kubeNamespace: input.kubeNamespace ?? input.key,
    clusterProfile,
    appHost: apps[0].host,
    apps,
    deployRef,
    enabled,
    gitlabEnvironment: input.key,
  };
}

/**
 * Env-scoped CI variables for one app within a deployment target.
 */
export function buildPerAppDeployVariables(
  target: DeploymentTarget,
  app: TargetApp,
  effectiveSlug: string,
  vaultBasePath: string,
  kubeconfigB64: string | undefined,
): DeployCiVariable[] {
  const scope = appEnvironmentScope(target.key, app.name);
  const helmRelease = resolveHelmReleaseName(effectiveSlug, app.image);
  const vars: DeployCiVariable[] = [
    { key: 'KUBE_NAMESPACE', value: target.kubeNamespace, environmentScope: scope, masked: false },
    { key: 'APP_HOST', value: app.host, environmentScope: scope, masked: false },
    { key: 'VAULT_PROJECT_PATH', value: vaultBasePath, environmentScope: scope, masked: false },
    { key: 'DEPLOY_ENV', value: target.key, environmentScope: scope, masked: false },
    {
      key: 'EXTRA_HELM_ARGS',
      value: `--set image.repository=$CI_REGISTRY_IMAGE/${app.image}`,
      environmentScope: scope,
      masked: false,
    },
    {
      key: 'HELM_RELEASE_NAME',
      value: helmRelease,
      environmentScope: scope,
      masked: false,
    },
  ];

  if (kubeconfigB64) {
    vars.push({
      key: 'KUBECONFIG_B64',
      value: kubeconfigB64,
      environmentScope: scope,
      masked: true,
    });
  }

  return vars;
}

/**
 * Env-scoped CI variables required for `.deploy-helm` jobs (legacy single-app per target).
 */
export function buildEnvScopedDeployVariables(
  target: DeploymentTarget,
  vaultBasePath: string,
  kubeconfigB64: string | undefined,
): DeployCiVariable[] {
  const scope = target.gitlabEnvironment ?? target.key;
  const vars: DeployCiVariable[] = [
    { key: 'KUBE_NAMESPACE', value: target.kubeNamespace, environmentScope: scope, masked: false },
    { key: 'APP_HOST', value: target.appHost, environmentScope: scope, masked: false },
    { key: 'VAULT_PROJECT_PATH', value: vaultBasePath, environmentScope: scope, masked: false },
    { key: 'DEPLOY_ENV', value: target.key, environmentScope: scope, masked: false },
  ];

  if (kubeconfigB64) {
    vars.push({
      key: 'KUBECONFIG_B64',
      value: kubeconfigB64,
      environmentScope: scope,
      masked: true,
    });
  }

  return vars;
}

/**
 * All deploy-related CI variables for a target (per-app or legacy scope).
 */
export function buildDeployVariablesForTarget(
  target: DeploymentTarget,
  effectiveSlug: string,
  appsDomain: string,
  vaultBasePath: string,
  kubeconfigB64: string | undefined,
): DeployCiVariable[] {
  const withApps = ensureTargetApps(target, effectiveSlug, appsDomain);
  if (targetUsesPerAppDeploy(withApps) && withApps.apps?.length) {
    return withApps.apps.flatMap((app) =>
      buildPerAppDeployVariables(withApps, app, effectiveSlug, vaultBasePath, kubeconfigB64),
    );
  }
  return buildEnvScopedDeployVariables(target, vaultBasePath, kubeconfigB64);
}

/**
 * Global (wildcard-scoped) deploy ref variable for a target.
 */
export function buildDeployRefVariable(target: DeploymentTarget): DeployCiVariable {
  return {
    key: deployRefVariableName(target.key),
    value: target.deployRef,
    environmentScope: '*',
    masked: false,
  };
}

/** Keys removed when a deployment target or app scope is deleted. */
export const ENV_SCOPED_DEPLOY_VAR_KEYS = [
  'KUBE_NAMESPACE',
  'APP_HOST',
  'VAULT_PROJECT_PATH',
  'KUBECONFIG_B64',
  'DEPLOY_ENV',
  'EXTRA_HELM_ARGS',
  'HELM_RELEASE_NAME',
] as const;

/** Global CI variables for Vault access during build jobs. */
export const VAULT_CI_VAR_KEYS = ['VAULT_ADDR', 'VAULT_TOKEN', 'VAULT_PROJECT_PATH'] as const;

/**
 * GitLab CI variables so pipelines can read env profiles from Vault (build phase).
 */
export function buildVaultAccessCiVariables(
  vaultAddr: string,
  vaultToken: string,
  vaultBasePath: string,
): DeployCiVariable[] {
  return [
    { key: 'VAULT_ADDR', value: vaultAddr, environmentScope: '*', masked: false },
    { key: 'VAULT_TOKEN', value: vaultToken, environmentScope: '*', masked: true },
    { key: 'VAULT_PROJECT_PATH', value: vaultBasePath, environmentScope: '*', masked: false },
  ];
}

/**
 * Lists all per-app GitLab environment scopes for a target.
 */
export function listAppEnvironmentScopes(target: DeploymentTarget): string[] {
  if (!target.apps?.length) {
    return [target.gitlabEnvironment ?? target.key];
  }
  return target.apps.map((app) => appEnvironmentScope(target.key, app.name));
}
