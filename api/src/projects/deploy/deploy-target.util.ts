import { BadRequestException } from '@nestjs/common';

import {
  DEFAULT_DEPLOY_REFS,
  DEPLOY_REF_DISABLED,
  STANDARD_DEPLOY_TARGET_KEYS,
  type StandardDeployTargetKey,
} from './deploy.constants';

import type { ClusterProfile, DeploymentTarget } from '../schemas/project.schema';

/** DNS-label style target key: lowercase, hyphens, must start with a letter. */
export const TARGET_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Maps a deployment target key to the GitLab CI variable that gates its deploy job.
 * e.g. `prod-alt` → `DEPLOY_PROD_ALT_REF`
 */
export function deployRefVariableName(targetKey: string): string {
  const normalized = targetKey.toUpperCase().replaceAll('-', '_');
  return `DEPLOY_${normalized}_REF`;
}

/** @returns true when deploy ref is the platform deactivation sentinel. */
export function isDeployRefDisabled(deployRef: string): boolean {
  return deployRef === DEPLOY_REF_DISABLED;
}

/**
 * Validates a deploy ref for enabled targets.
 * @throws BadRequestException when ref is empty, null-like, or `none` while enabling
 */
export function assertValidActiveDeployRef(deployRef: string, enabled: boolean): void {
  if (!deployRef || deployRef.trim() === '') {
    throw new BadRequestException(
      'deployRef must be a non-empty branch name or "none" when disabling',
    );
  }
  if (deployRef === 'null') {
    throw new BadRequestException('deployRef "null" is not allowed; use "none" to disable deploys');
  }
  if (enabled && isDeployRefDisabled(deployRef)) {
    throw new BadRequestException(
      'Cannot enable a target with deployRef "none"; set enabled=false to disable',
    );
  }
}

/** @throws BadRequestException when key format is invalid */
export function assertValidTargetKey(targetKey: string): void {
  if (!TARGET_KEY_PATTERN.test(targetKey)) {
    throw new BadRequestException(
      `targetKey "${targetKey}" must match ${TARGET_KEY_PATTERN.source} (e.g. dev, prod-alt)`,
    );
  }
}

export function isStandardTargetKey(key: string): key is StandardDeployTargetKey {
  return (STANDARD_DEPLOY_TARGET_KEYS as readonly string[]).includes(key);
}

/**
 * Resolves default branch ref for standard keys; custom keys require an explicit ref.
 */
export function resolveDefaultDeployRef(targetKey: string): string | undefined {
  if (isStandardTargetKey(targetKey)) {
    return DEFAULT_DEPLOY_REFS[targetKey];
  }
  return undefined;
}

/**
 * Infers cluster profile from target key when not explicitly provided.
 */
export function inferClusterProfile(targetKey: string): ClusterProfile | undefined {
  if (targetKey === 'dev') {
    return 'dev';
  }
  if (targetKey === 'stg') {
    return 'stg';
  }
  if (targetKey === 'prod' || targetKey.startsWith('prod-')) {
    return 'prod';
  }
  return undefined;
}

/** Whether the shared pipeline template already defines a job for this key. */
export function isTemplateBuiltinTarget(targetKey: string): boolean {
  return isStandardTargetKey(targetKey);
}

/**
 * Builds default app hostname for a target key and effective slug.
 */
export function buildDefaultAppHost(
  targetKey: string,
  effectiveSlug: string,
  appsDomain: string,
): string {
  if (targetKey === 'prod') {
    return `${effectiveSlug}.${appsDomain}`;
  }
  return `${effectiveSlug}.${targetKey}.${appsDomain}`;
}

/**
 * Derives legacy `appHosts` map from deployment targets for GraphQL backward compat.
 */
export function appHostsFromTargets(targets: DeploymentTarget[]): {
  dev?: string;
  stg?: string;
  prod?: string;
} {
  const result: { dev?: string; stg?: string; prod?: string } = {};
  for (const t of targets) {
    if (t.key === 'dev' || t.key === 'stg' || t.key === 'prod') {
      result[t.key] = t.appHost;
    }
  }
  return result;
}

/**
 * Builds three standard targets from legacy appHosts / deployable flag.
 */
/** Per-environment branch overrides for dev/stg/prod deploy refs. */
export interface DeployBranchRefs {
  dev?: string;
  stg?: string;
  prod?: string;
}

export interface ApplyDeployBranchOverridesOptions {
  deployRefs?: DeployBranchRefs;
  /**
   * Default Git branch: used for pipeline trigger and as prod deploy ref
   * when deployRefs.prod is omitted.
   */
  defaultBranch?: string;
  /** When true, sets all enabled standard targets to defaultBranch. */
  useDefaultBranchForAllDeployTargets?: boolean;
}

/**
 * Applies optional branch overrides to standard deployment targets (dev/stg/prod).
 */
export function applyDeployBranchOverrides(
  targets: DeploymentTarget[],
  options: ApplyDeployBranchOverridesOptions,
): DeploymentTarget[] {
  const defaultBranch = options.defaultBranch?.trim();
  const useAll = options.useDefaultBranchForAllDeployTargets === true && !!defaultBranch;

  if (!defaultBranch && !options.deployRefs && !useAll) {
    return targets;
  }

  return targets.map((target) => {
    if (!(STANDARD_DEPLOY_TARGET_KEYS as readonly string[]).includes(target.key)) {
      return target;
    }

    const key = target.key as StandardDeployTargetKey;
    const explicit = options.deployRefs?.[key]?.trim();

    if (explicit) {
      assertValidActiveDeployRef(explicit, target.enabled);
      return { ...target, deployRef: explicit };
    }

    if (useAll && target.enabled) {
      assertValidActiveDeployRef(defaultBranch!, true);
      return { ...target, deployRef: defaultBranch! };
    }

    if (defaultBranch && key === 'prod' && target.enabled) {
      assertValidActiveDeployRef(defaultBranch, true);
      return { ...target, deployRef: defaultBranch };
    }

    return target;
  });
}

export function deriveStandardDeploymentTargets(
  effectiveSlug: string,
  appsDomain: string,
  deployable: boolean,
  appHosts?: { dev?: string; stg?: string; prod?: string },
  hostnameOverrides?: { dev?: string; stg?: string; prod?: string },
): DeploymentTarget[] {
  return STANDARD_DEPLOY_TARGET_KEYS.map((key) => {
    const host =
      hostnameOverrides?.[key] ??
      appHosts?.[key] ??
      buildDefaultAppHost(key, effectiveSlug, appsDomain);
    const defaultRef = DEFAULT_DEPLOY_REFS[key];
    return {
      key,
      kubeNamespace: key,
      clusterProfile: key as ClusterProfile,
      appHost: host,
      deployRef: deployable ? defaultRef : DEPLOY_REF_DISABLED,
      enabled: deployable,
      gitlabEnvironment: key,
    };
  });
}

/**
 * Ensures `doc.deploymentTargets` is populated (lazy migration for existing records).
 */
export function ensureDeploymentTargets(
  doc: {
    deploymentTargets?: DeploymentTarget[];
    effectiveSlug: string;
    capabilities?: { deployable?: boolean };
    appHosts?: { dev?: string; stg?: string; prod?: string };
    hostnameOverrides?: { dev?: string; stg?: string; prod?: string };
  },
  appsDomain: string,
): DeploymentTarget[] {
  if (doc.deploymentTargets?.length) {
    return doc.deploymentTargets;
  }
  return deriveStandardDeploymentTargets(
    doc.effectiveSlug,
    appsDomain,
    doc.capabilities?.deployable ?? false,
    doc.appHosts,
    doc.hostnameOverrides,
  );
}
