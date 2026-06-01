import { BadRequestException } from '@nestjs/common';

import { TARGET_KEY_PATTERN } from './deploy-target.util';

import type { TargetApp } from '../schemas/project.schema';

/** App name / image must be DNS-label safe (GitLab job names, registry paths). */
export const APP_LABEL_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * GitLab CI/CD environment scope for per-app deploy variables.
 * Uses hyphen form (GitLab accepts this reliably for variable filters).
 */
export function appEnvironmentScope(targetKey: string, appName: string): string {
  return `${targetKey}-${appName}`;
}

/**
 * Derives ingress host for an app within a deployment target.
 *
 * @param appName - Application identifier (DNS label)
 * @param targetKey - Deployment target key (e.g. dev, prod, prod-alt)
 * @param appsDomain - Platform apps zone (e.g. example.apps.domain.com)
 */
export function deriveAppHost(appName: string, targetKey: string, appsDomain: string): string {
  if (targetKey === 'prod') {
    return `${appName}.${appsDomain}`;
  }
  return `${appName}.${targetKey}.${appsDomain}`;
}

/**
 * Helm release name for a single app surface within a project.
 */
export function resolveHelmReleaseName(effectiveSlug: string, appImage: string): string {
  if (appImage === effectiveSlug) {
    return effectiveSlug;
  }
  return `${effectiveSlug}-${appImage}`;
}

/** Default dockerfile when omitted. */
export function resolveDockerfile(dockerfile?: string): string {
  const trimmed = dockerfile?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Dockerfile';
}

/**
 * Validates app rows on a deployment target.
 *
 * @throws BadRequestException when names/images duplicate or labels are invalid
 */
export function assertValidTargetApps(apps: TargetApp[]): void {
  if (!apps.length) {
    throw new BadRequestException('At least one app is required on a deployment target');
  }

  const names = new Set<string>();
  const images = new Set<string>();

  for (const app of apps) {
    if (!APP_LABEL_PATTERN.test(app.name)) {
      throw new BadRequestException(
        `app name "${app.name}" must match ${APP_LABEL_PATTERN.source}`,
      );
    }
    if (!APP_LABEL_PATTERN.test(app.image)) {
      throw new BadRequestException(
        `app image "${app.image}" must match ${APP_LABEL_PATTERN.source}`,
      );
    }
    if (names.has(app.name)) {
      throw new BadRequestException(`duplicate app name "${app.name}" on this target`);
    }
    if (images.has(app.image)) {
      throw new BadRequestException(`duplicate app image "${app.image}" on this target`);
    }
    names.add(app.name);
    images.add(app.image);
  }
}

export interface NormalizeTargetAppInput {
  name: string;
  image: string;
  dockerfile?: string | null;
  host?: string | null;
}

/**
 * Resolves hosts and dockerfile defaults for apps on save.
 */
export function normalizeTargetApps(
  inputs: NormalizeTargetAppInput[],
  targetKey: string,
  appsDomain: string,
): TargetApp[] {
  assertValidTargetApps(
    inputs.map((a) => ({
      name: a.name.trim(),
      image: a.image.trim(),
      dockerfile: resolveDockerfile(a.dockerfile ?? undefined),
      host: a.host?.trim() ?? '',
    })),
  );

  return inputs.map((a) => {
    const name = a.name.trim();
    const image = a.image.trim();
    const host = a.host?.trim() || deriveAppHost(name, targetKey, appsDomain);
    return {
      name,
      image,
      dockerfile: resolveDockerfile(a.dockerfile ?? undefined),
      host,
    };
  });
}

/**
 * Synthetic single-app row for legacy targets missing `apps`.
 */
export function syntheticAppFromLegacyTarget(
  effectiveSlug: string,
  targetKey: string,
  appHost: string,
): TargetApp[] {
  const name = effectiveSlug;
  return [
    {
      name,
      image: name,
      dockerfile: 'Dockerfile',
      host: appHost || deriveAppHost(name, targetKey, ''),
    },
  ];
}

/** Whether this target uses generated per-app deploy jobs (disables template built-ins). */
export function targetUsesPerAppDeploy(target: { apps?: TargetApp[] }): boolean {
  return (target.apps?.length ?? 0) > 0;
}
