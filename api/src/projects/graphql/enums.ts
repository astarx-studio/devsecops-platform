import { registerEnumType } from '@nestjs/graphql';

/**
 * Deployment environment — matches the k3d namespace names (dev, stg, prod).
 * Used in mutations that target a specific environment (e.g. setHostnameOverride).
 */
export enum Env {
  DEV = 'dev',
  STG = 'stg',
  PROD = 'prod',
}

registerEnumType(Env, {
  name: 'Env',
  description: 'Deployment environment (matches k3d namespace names).',
  valuesMap: {
    DEV: { description: 'Development environment' },
    STG: { description: 'Staging environment' },
    PROD: { description: 'Production environment' },
  },
});

/**
 * Project provisioning strategy.
 * - AUTO_DEVOPS: project was created directly with Auto DevOps pipeline
 * - TEMPLATE: project was forked from a template in the templates group
 */
export enum Provisioning {
  AUTO_DEVOPS = 'auto-devops',
  TEMPLATE = 'template',
}

registerEnumType(Provisioning, {
  name: 'Provisioning',
  description: 'How the project was initially provisioned.',
  valuesMap: {
    AUTO_DEVOPS: { description: 'Created with Auto DevOps pipeline (no template fork)' },
    TEMPLATE: { description: 'Forked from a template in the templates group' },
  },
});

/** Sonar quality gate enforcement for a deploy tier. */
export enum SonarGateMode {
  OPTIONAL = 'optional',
  REQUIRED = 'required',
}

registerEnumType(SonarGateMode, {
  name: 'SonarGateMode',
  description: 'Whether a failed Sonar Quality Gate fails the CI job for that deploy tier.',
});

/**
 * Cluster profile — selects which platform kubeconfig connects to a deployment target.
 */
export enum ClusterProfile {
  DEV = 'dev',
  STG = 'stg',
  PROD = 'prod',
}

registerEnumType(ClusterProfile, {
  name: 'ClusterProfile',
  description: 'Platform kubeconfig profile (dev, stg, prod clusters).',
});

/** Outcome of deleteProject — removed from registry or archived when GitLab delete fails. */
export enum DeleteProjectOutcome {
  DELETED = 'deleted',
  ARCHIVED = 'archived',
}

registerEnumType(DeleteProjectOutcome, {
  name: 'DeleteProjectOutcome',
  description: 'Whether deleteProject fully removed the project or archived it for retry.',
});
