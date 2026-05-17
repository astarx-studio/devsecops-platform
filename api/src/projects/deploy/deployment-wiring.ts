import { BadRequestException } from '@nestjs/common';

import { DEPLOY_REF_DISABLED } from './deploy.constants';
import { deployRefVariableName } from './deploy-target.util';
import {
  assertValidActiveDeployRef,
  assertValidTargetKey,
  buildDefaultAppHost,
  inferClusterProfile,
  resolveDefaultDeployRef,
} from './deploy-target.util';

import type { ClusterProfile, DeploymentTarget } from '../schemas/project.schema';
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

  return {
    key: input.key,
    kubeNamespace: input.kubeNamespace ?? input.key,
    clusterProfile,
    appHost: input.appHost ?? buildDefaultAppHost(input.key, effectiveSlug, appsDomain),
    deployRef,
    enabled,
    gitlabEnvironment: input.key,
  };
}

/**
 * Env-scoped CI variables required for `.deploy-helm` jobs.
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

/** Keys removed when a deployment target is deleted from a project. */
export const ENV_SCOPED_DEPLOY_VAR_KEYS = [
  'KUBE_NAMESPACE',
  'APP_HOST',
  'VAULT_PROJECT_PATH',
  'KUBECONFIG_B64',
  'DEPLOY_ENV',
] as const;
